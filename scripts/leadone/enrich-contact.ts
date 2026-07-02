import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { crawlSite } from "../../src/lib/leadone/crawler";
import { takeQuota } from "../../src/lib/leadone/quota";

// Lead One stage 3 — email / phone / speciality extraction by politely
// crawling the candidate's own website (homepage + contact + mentions
// légales). Free and unlimited, so this is where most of the run's time goes;
// the orchestrator passes a deadline. Optional top-up: Hunter.io (25/month)
// for candidates whose site yielded no email at all.
//
// Usage: npx tsx scripts/leadone/enrich-contact.ts [--dry] [--limit=50]

const MAX_ATTEMPTS = 3;

interface HunterHit {
  email: string;
  kind: "NOMINATIVE" | "GENERIC";
}

async function hunterDomainSearch(
  prisma: PrismaClient,
  siteWeb: string,
): Promise<HunterHit | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  let domain: string;
  try {
    domain = new URL(siteWeb).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!(await takeQuota(prisma, "hunter"))) return null;
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=1&api_key=${key}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { emails?: { value?: string; type?: string }[] };
    };
    const hit = data.data?.emails?.[0];
    if (!hit?.value) return null;
    return {
      email: hit.value.toLowerCase(),
      kind: hit.type === "personal" ? "NOMINATIVE" : "GENERIC",
    };
  } catch {
    return null;
  }
}

export interface ContactStats {
  crawled: number;
  withEmail: number;
  withPhone: number;
  retried: number;
  rejected: number;
}

export async function runEnrichContact(
  prisma: PrismaClient,
  opts: { limit?: number; dry?: boolean; deadline?: number } = {},
): Promise<ContactStats> {
  const stats: ContactStats = {
    crawled: 0,
    withEmail: 0,
    withPhone: 0,
    retried: 0,
    rejected: 0,
  };
  const candidates = await prisma.leadCandidate.findMany({
    where: { status: "ENRICHED_WEBSITE" },
    orderBy: { updatedAt: "asc" },
    take: opts.limit ?? 300,
    select: { id: true, siren: true, nomSociete: true, enseigne: true, siteWeb: true, attempts: true, provenance: true },
  });

  for (const c of candidates) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    if (!c.siteWeb) continue;
    const name = c.enseigne || c.nomSociete || c.siteWeb;
    const attempts = (c.attempts ?? {}) as Record<string, number>;

    const r = await crawlSite(c.siteWeb, {
      siren: c.siren,
      name: c.nomSociete ?? c.enseigne,
    });

    // Site unreachable → retry another day (may be transient), 3 strikes out.
    if (r.pagesFetched === 0) {
      const next = (attempts.contact ?? 0) + 1;
      const dead = next >= MAX_ATTEMPTS;
      if (dead) stats.rejected++;
      else stats.retried++;
      console.log(`! ${name} — site unreachable (attempt ${next}/${MAX_ATTEMPTS})`);
      if (!opts.dry)
        await prisma.leadCandidate.update({
          where: { id: c.id },
          data: dead
            ? { status: "REJECTED", lastError: "site-unreachable", attempts: { ...attempts, contact: next } }
            : { attempts: { ...attempts, contact: next } },
        });
      continue;
    }

    // Site reachable but never mentions the company's SIREN/SIRET or name →
    // almost certainly a wrong search match (precision guard). Un-assign it
    // and send the candidate back to website discovery; the attempt counter
    // moves the next search to a different query variant, 3 strikes total.
    if (!r.verified) {
      const next = (attempts.website ?? 0) + 1;
      const dead = next >= MAX_ATTEMPTS;
      if (dead) stats.rejected++;
      else stats.retried++;
      console.log(
        `✗ ${name} — ${c.siteWeb} never mentions the company (wrong site, attempt ${next}/${MAX_ATTEMPTS})`,
      );
      if (!opts.dry)
        await prisma.leadCandidate.update({
          where: { id: c.id },
          data: dead
            ? { status: "REJECTED", lastError: "website-not-verified", attempts: { ...attempts, website: next } }
            : { siteWeb: null, status: "SOURCED", attempts: { ...attempts, website: next } },
        });
      continue;
    }

    stats.crawled++;
    let email = r.email;
    let emailKind: string = r.emailKind;
    const provenance = { ...((c.provenance ?? {}) as Record<string, unknown>) };
    if (email) provenance.email = { src: "crawl", at: new Date().toISOString() };
    if (r.phone) provenance.telephone = { src: "crawl", at: new Date().toISOString() };

    if (!email) {
      const hunter = await hunterDomainSearch(prisma, c.siteWeb);
      if (hunter) {
        email = hunter.email;
        emailKind = hunter.kind;
        provenance.email = { src: "hunter", at: new Date().toISOString() };
      }
    }

    if (email) stats.withEmail++;
    if (r.phone) stats.withPhone++;
    console.log(
      `✓ ${name} — ${email ?? "no email"} / ${r.phone ?? "no phone"} ` +
        `(${Object.keys(r.specialites).join(", ") || "no speciality"})`,
    );
    if (!opts.dry)
      await prisma.leadCandidate.update({
        where: { id: c.id },
        data: {
          email,
          emailKind: email ? emailKind : "NONE",
          telephone: r.phone,
          specialites: r.specialites as Prisma.InputJsonValue,
          status: "ENRICHED_CONTACT",
          provenance: provenance as Prisma.InputJsonValue,
        },
      });
  }
  return stats;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const prisma = new PrismaClient();
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;
  runEnrichContact(prisma, { dry, limit })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}Crawl: ${s.crawled} sites, ${s.withEmail} emails, ` +
          `${s.withPhone} phones, ${s.retried} retries, ${s.rejected} rejected.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

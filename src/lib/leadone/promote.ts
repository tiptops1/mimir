import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCompanyName, normalizeDomain } from "../dedupe";
import { logAudit } from "../audit";

// Promotion: the ONLY door from Lead One staging into the real CRM. Guards, in
// order: SIRET (unique on both sides), normalized website domain, normalized
// company name, and the BlockedSender opt-out list — a duplicate or blocked
// candidate is marked REJECTED, never silently merged. Shared by the /leadone
// server action (Approve) and the batch CLI (scripts/leadone/promote.ts).

export interface PromoteResult {
  outcome: "PROMOTED" | "REJECTED" | "SKIPPED";
  reason?: string;
  companyId?: string;
}

interface DirigeantJson {
  nom?: string | null;
  prenom?: string | null;
  qualite?: string | null;
  linkedinUrl?: string | null;
}

export async function promoteCandidate(
  prisma: PrismaClient,
  candidateId: string,
  userId?: string | null,
): Promise<PromoteResult> {
  const c = await prisma.leadCandidate.findUnique({ where: { id: candidateId } });
  if (!c) return { outcome: "SKIPPED", reason: "not-found" };
  if (c.status === "PROMOTED") {
    return {
      outcome: "SKIPPED",
      reason: "already-promoted",
      companyId: c.promotedCompanyId ?? undefined,
    };
  }

  const reject = async (reason: string): Promise<PromoteResult> => {
    await prisma.leadCandidate.update({
      where: { id: c.id },
      data: { status: "REJECTED", lastError: reason, reviewedBy: userId ?? null },
    });
    return { outcome: "REJECTED", reason };
  };

  // 1) SIRET — the hard key.
  const bySiret = await prisma.company.findUnique({ where: { siret: c.siret } });
  if (bySiret) return reject("duplicate:siret");

  // 2) Opt-out list: an email whose address/domain was blocked never re-enters.
  if (c.email) {
    const domain = c.email.split("@")[1] ?? "";
    const blocked = await prisma.blockedSender.findFirst({
      where: { value: { in: [c.email.toLowerCase(), domain.toLowerCase()] } },
    });
    if (blocked) return reject("blocked-sender");
  }

  // 3) Soft keys — normalized domain and name against existing companies.
  const candDomain = normalizeDomain(c.siteWeb);
  const candName = normalizeCompanyName(c.enseigne || c.nomSociete);
  const existing = await prisma.company.findMany({
    select: { id: true, nomSociete: true, enseigne: true, siteWeb: true },
  });
  for (const e of existing) {
    if (candDomain && normalizeDomain(e.siteWeb) === candDomain)
      return reject("duplicate:domain");
    if (
      candName.length >= 5 &&
      normalizeCompanyName(e.enseigne || e.nomSociete) === candName
    )
      return reject("duplicate:name");
  }

  const spec = (c.specialites ?? {}) as Record<string, boolean>;
  const company = await prisma.company.create({
    data: {
      siren: c.siren,
      siret: c.siret,
      nomSociete: c.nomSociete,
      enseigne: c.enseigne,
      siteWeb: c.siteWeb,
      emailGenerique: c.email,
      telephoneStandard: c.telephone,
      specialiteSante: Boolean(spec.sante),
      specialitePrevoyance: Boolean(spec.prevoyance),
      specialiteIard: Boolean(spec.iard),
      specialiteAuto: Boolean(spec.auto),
      specialiteRcPro: Boolean(spec.rcPro),
      specialiteEntreprises: Boolean(spec.entreprises),
      specialiteCollectives: Boolean(spec.collectives),
      specialiteParticuliers: Boolean(spec.particuliers),
      // stage stays the schema default (first pipeline stage).
      customFields: {
        leadOne: {
          confidence: c.confidence,
          provenance: c.provenance ?? {},
          promotedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  });

  const dirigeants = (c.dirigeants ?? []) as DirigeantJson[];
  for (const d of dirigeants) {
    const nom = d.nom?.trim() || null;
    const prenom = d.prenom?.trim() || null;
    if (!nom && !prenom) continue;
    await prisma.contact.create({
      data: {
        companyId: company.id,
        nom,
        prenom,
        fonction: d.qualite?.trim() || "Dirigeant",
        linkedinUrl: d.linkedinUrl?.trim() || null,
        // consent stays null (unknown) — RGPD status is set by outreach flows.
      },
    });
  }

  await prisma.leadCandidate.update({
    where: { id: c.id },
    data: {
      status: "PROMOTED",
      promotedCompanyId: company.id,
      reviewedBy: userId ?? null,
      lastError: null,
    },
  });
  await logAudit(prisma, {
    userId,
    action: "LEADONE_PROMOTE",
    entity: "COMPANY",
    entityId: company.id,
    details: `Lead One → ${c.enseigne || c.nomSociete || c.siret} (confiance ${c.confidence})`,
  });
  return { outcome: "PROMOTED", companyId: company.id };
}

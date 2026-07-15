import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../src/generated/control";
import {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/lib/outreach/unsubscribe";
import { canEnroll } from "../src/lib/outreach/enroll";

/**
 * Opt-out end-to-end probe: real HTTP against the local dev server
 * (localhost:3000), real tenant DB. Creates a company + enrollment + ledger
 * row, hits GET (confirm page) then POST (opt-out), asserts BlockedSender +
 * consent + enrollment + audit effects, checks re-enrollment is refused,
 * checks a tampered token 400s. Cleans up after itself.
 *
 *   npx tsx scripts/test-outreach-unsubscribe.ts   (dev server must be running)
 */

const SIRET = "00000000000004";
const EMAIL = "optout-probe@example.com";
const BASE = "http://localhost:3000";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  OK  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

async function main() {
  const prisma = new PrismaClient();
  const control = new ControlClient({
    datasourceUrl: process.env.CONTROL_DATABASE_URL,
  });
  const tenant = await control.tenant.findUnique({
    where: { slug: process.env.TEST_TENANT_SLUG || "crm_demo" },
  });
  if (!tenant) throw new Error("test tenant not found");

  // ---------- fixtures ----------
  const stale = await prisma.company.findUnique({ where: { siret: SIRET } });
  if (stale) await prisma.company.delete({ where: { id: stale.id } });
  await prisma.blockedSender.deleteMany({ where: { value: EMAIL } });
  await prisma.sequence.deleteMany({ where: { name: "PROBE OPTOUT" } });

  const company = await prisma.company.create({
    data: { siret: SIRET, nomSociete: "PROBE Optout", emailGenerique: EMAIL },
  });
  const sequence = await prisma.sequence.create({
    data: {
      name: "PROBE OPTOUT",
      mode: "AUTO_EMAIL",
      active: true,
      steps: [
        { offsetDays: 0, channel: "EMAIL", title: "A", subject: "S", body: "B" },
      ],
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: {
      companyId: company.id,
      sequenceId: sequence.id,
      currentStep: 1,
      status: "ACTIVE",
      nextDueAt: new Date(),
    },
  });
  await prisma.outreachMessage.create({
    data: {
      enrollmentId: enrollment.id,
      companyId: company.id,
      sequenceId: sequence.id,
      stepIndex: 0,
      toEmail: EMAIL,
      subject: "S",
      body: "B",
      messageId: "<optout-probe@example.com>",
    },
  });

  // ---------- token sanity ----------
  const token = mintUnsubscribeToken(tenant.id, enrollment.id);
  const parsed = verifyUnsubscribeToken(token);
  check("token round-trips", parsed?.enrollmentId === enrollment.id);
  const tampered = token.slice(0, -4) + "AAAA";
  check("tampered token rejected locally", verifyUnsubscribeToken(tampered) === null);

  // ---------- HTTP ----------
  const url = `${BASE}/api/outreach/unsubscribe?t=${token}`;
  const get = await fetch(url);
  const getBody = await get.text();
  check("GET 200", get.status === 200, get.status);
  check("GET shows confirm page (no opt-out yet)", getBody.includes("Me désinscrire"));
  const midway = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  check("GET did NOT opt out (scanner-proof)", midway?.status === "ACTIVE");

  const bad = await fetch(`${BASE}/api/outreach/unsubscribe?t=${tampered}`);
  check("tampered token → 400", bad.status === 400, bad.status);

  const post = await fetch(url, { method: "POST" });
  const postBody = await post.text();
  check("POST 200", post.status === 200, post.status);
  check("POST confirms", postBody.includes("Désinscription confirmée"));

  // ---------- effects ----------
  const blocked = await prisma.blockedSender.findUnique({ where: { value: EMAIL } });
  check("BlockedSender row created", blocked?.kind === "EMAIL");
  const enrAfter = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  check("enrollment OPTED_OUT", enrAfter?.status === "OPTED_OUT" && enrAfter?.nextDueAt === null);
  const audit = await prisma.auditLog.findFirst({
    where: { action: "OUTREACH_OPTOUT", entityId: enrollment.id },
  });
  check("audit trail entry", Boolean(audit), audit?.details);
  const note = await prisma.activity.findFirst({
    where: { companyId: company.id, type: "NOTE" },
  });
  check("timeline note", Boolean(note));

  const reEnroll = await canEnroll(prisma, company.id);
  check(
    "re-enrollment refused (blocked address)",
    !reEnroll.ok && /bloquée/.test((reEnroll as { reason: string }).reason),
    reEnroll,
  );

  // ---------- cleanup ----------
  await prisma.auditLog.deleteMany({
    where: { action: "OUTREACH_OPTOUT", entityId: enrollment.id },
  });
  await prisma.blockedSender.deleteMany({ where: { value: EMAIL } });
  await prisma.company.delete({ where: { id: company.id } });
  await prisma.sequence.delete({ where: { id: sequence.id } });
  await prisma.$disconnect();
  await control.$disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

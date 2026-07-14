import { NextResponse, type NextRequest } from "next/server";
import { controlPrisma } from "@/lib/control-db";
import { decrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe";
import { logAudit } from "@/lib/audit";

// Public opt-out endpoint for cold emails (RGPD). Session-less by design — the
// prospect isn't a user. The HMAC token identifies tenant + enrollment; the
// tenant DB is resolved the same way the cron does. GET shows a one-button
// confirmation page (link scanners follow GETs — a bare-GET opt-out would
// unsubscribe people who never clicked); POST (also RFC 8058 One-Click) does it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, body: string, button?: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;
    max-width:420px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;color:#475569;margin:0 0 20px}
  button{background:#dc2626;color:#fff;border:0;border-radius:8px;padding:10px 20px;
    font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#b91c1c}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p>${button ?? ""}</div></body></html>`;
}

function html(markup: string, status = 200): NextResponse {
  return new NextResponse(markup, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const invalidPage = () =>
  html(
    page(
      "Lien invalide",
      "Ce lien de désinscription est invalide ou a expiré. Vous pouvez simplement ignorer nos emails — ils s'arrêteront d'eux-mêmes.",
    ),
    400,
  );

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!verifyUnsubscribeToken(token)) return invalidPage();

  return html(
    page(
      "Se désinscrire ?",
      "Confirmez pour ne plus jamais recevoir d'email de notre part. C'est immédiat et définitif.",
      `<form method="post"><button type="submit">Me désinscrire</button></form>`,
    ),
  );
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const ids = verifyUnsubscribeToken(token);
  if (!ids) return invalidPage();

  const tenant = await controlPrisma.tenant.findUnique({
    where: { id: ids.tenantId },
  });
  if (!tenant) return invalidPage();
  const prisma = getTenantPrisma(decrypt(tenant.connectionString));

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: ids.enrollmentId },
  });
  // Enrollment may have been purged — the opt-out is still "done" for the user.
  if (enrollment) {
    // The address that actually received the mails, from the ledger.
    const lastMsg = await prisma.outreachMessage.findFirst({
      where: { enrollmentId: enrollment.id },
      orderBy: { sentAt: "desc" },
    });
    const email = lastMsg?.toEmail?.toLowerCase() ?? null;

    if (email) {
      // Address-level block, not domain: one person opting out must not
      // blacklist their whole company domain.
      await prisma.blockedSender.upsert({
        where: { value: email },
        update: {},
        create: { value: email, kind: "EMAIL" },
      });
      await prisma.contact.updateMany({
        where: { email: { equals: email, mode: "insensitive" } },
        data: { consent: "OPT_OUT", consentAt: new Date() },
      });
    }
    if (lastMsg?.contactId) {
      await prisma.contact.update({
        where: { id: lastMsg.contactId },
        data: { consent: "OPT_OUT", consentAt: new Date() },
      });
    }
    // Exit every live enrollment of the company, not just this one.
    await prisma.enrollment.updateMany({
      where: {
        companyId: enrollment.companyId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      data: { status: "OPTED_OUT", nextDueAt: null },
    });
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "OPTED_OUT", nextDueAt: null },
    });
    await prisma.activity.create({
      data: {
        companyId: enrollment.companyId,
        type: "NOTE",
        note: `Désinscription cold email${email ? ` (${email})` : ""} — adresse ajoutée à la liste bloquée.`,
      },
    });
    await logAudit(prisma, {
      action: "OUTREACH_OPTOUT",
      entity: "Enrollment",
      entityId: enrollment.id,
      details: email ? `Opt-out de ${email}` : "Opt-out (adresse inconnue)",
    });
  }

  return html(
    page(
      "Désinscription confirmée",
      "Vous ne recevrez plus d'email de notre part. Bonne journée !",
    ),
  );
}

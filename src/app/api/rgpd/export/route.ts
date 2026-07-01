import { NextResponse, type NextRequest } from "next/server";
import { getOptionalSession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit";

// RGPD droit d'accès: everything the CRM holds about one contact, as a JSON
// download. ADMIN-only + audited.

export async function GET(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "contactId requis" }, { status: 400 });
  }

  const prisma = await getTenantDb();
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      company: {
        select: { id: true, nomSociete: true, enseigne: true, siret: true },
      },
    },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact introuvable" }, { status: 404 });
  }

  const [activities, tasks] = await Promise.all([
    prisma.activity.findMany({
      where: { contactId },
      orderBy: { date: "asc" },
      select: {
        type: true,
        date: true,
        direction: true,
        subject: true,
        note: true,
        body: true,
        fromEmail: true,
        toEmail: true,
      },
    }),
    prisma.task.findMany({
      where: { contactId },
      select: { title: true, type: true, dueDate: true, done: true, note: true },
    }),
  ]);

  await logAudit(prisma, {
    userId: session.userId,
    action: "RGPD_EXPORT",
    entity: "CONTACT",
    entityId: contactId,
    details: `export JSON${contact.email ? ` (${contact.email})` : ""}`,
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    contact: {
      prenom: contact.prenom,
      nom: contact.nom,
      fonction: contact.fonction,
      email: contact.email,
      telephone: contact.telephone,
      linkedinUrl: contact.linkedinUrl,
      consent: contact.consent,
      consentAt: contact.consentAt,
      customFields: contact.customFields,
      createdAt: contact.createdAt,
    },
    societe: contact.company,
    activites: activities,
    taches: tasks,
  };

  const name = [contact.prenom, contact.nom].filter(Boolean).join("-") || contactId;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="rgpd-${name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "")}.json"`,
    },
  });
}

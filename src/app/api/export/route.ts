import { NextResponse, type NextRequest } from "next/server";
import { getOptionalSession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { buildCompanyWhere, buildContactWhere } from "@/lib/list-filters";
import { loadStageDefs } from "@/lib/stage-config";
import { companyName, contactName } from "@/lib/display";
import { SPECIALTY_FIELDS, PRIORITE_OPTIONS, POTENTIEL_OPTIONS } from "@/lib/constants";

/**
 * CSV export of the Suivi / Contacts lists, honoring the same URL filters as
 * the pages. GET /api/export?type=companies|contacts&<filters> → CSV download
 * (UTF-8 BOM + ";" separator so Excel FR opens it correctly).
 */

const MAX_ROWS = 5000;

type Cell = string | number | null | undefined;

function toCsv(rows: Cell[][]): string {
  const escape = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(escape).join(";")).join("\r\n");
}

const day = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

function csvResponse(rows: Cell[][], name: string): NextResponse {
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mimir-${name}-${today}.csv"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const type = sp.type === "contacts" ? "contacts" : "companies";
  const prisma = await getTenantDb();

  if (type === "contacts") {
    const where = buildContactWhere(sp);
    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      include: {
        company: {
          select: {
            nomSociete: true,
            enseigne: true,
            siret: true,
            ville: true,
            siteWeb: true,
            chiffreAffaires: true,
          },
        },
      },
    });
    const rows: Cell[][] = [
      [
        "Prénom",
        "Nom",
        "Fonction",
        "Email",
        "Téléphone",
        "LinkedIn",
        "Décideur",
        "Société",
        "SIRET",
        "Ville",
        "Site web",
        "Chiffre d'affaires",
      ],
      ...contacts.map((c) => [
        c.prenom,
        c.nom,
        c.fonction,
        c.email,
        c.telephone,
        c.linkedinUrl,
        c.isDecisionMaker ? "Oui" : "Non",
        companyName(c.company),
        c.company.siret,
        c.company.ville,
        c.company.siteWeb,
        c.company.chiffreAffaires,
      ]),
    ];
    return csvResponse(rows, "contacts");
  }

  const { where } = buildCompanyWhere(sp);
  const [companies, stageDefs] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: MAX_ROWS,
      include: {
        contacts: {
          select: {
            nom: true,
            prenom: true,
            email: true,
            telephone: true,
            isDecisionMaker: true,
          },
          orderBy: { createdAt: "asc" },
        },
        activities: {
          select: { date: true },
          orderBy: { date: "desc" },
          take: 1,
        },
      },
    }),
    loadStageDefs(prisma),
  ]);

  const stageLabel = new Map(stageDefs.map((s) => [s.value, s.label]));
  const prioriteLabel = new Map(PRIORITE_OPTIONS.map((o) => [o.value as string, o.label]));
  const potentielLabel = new Map(POTENTIEL_OPTIONS.map((o) => [o.value as string, o.label]));

  const rows: Cell[][] = [
    [
      "Société",
      "Enseigne",
      "SIRET",
      "Ville",
      "Code postal",
      "Contact principal",
      "Email contact",
      "Téléphone contact",
      "Étape",
      "Priorité",
      "Potentiel",
      "Canal préféré",
      "Spécialités",
      "Site web",
      "Chiffre d'affaires",
      "Premier contact",
      "Dernier contact",
      "Notes",
    ],
    ...companies.map((c) => {
      const dm = c.contacts.find((x) => x.isDecisionMaker) ?? c.contacts[0];
      const specialties = SPECIALTY_FIELDS.filter(
        (f) => c[f.key as keyof typeof c],
      )
        .map((f) => f.label)
        .join(", ");
      const lastTouch = c.dernierContact ?? c.activities[0]?.date ?? null;
      return [
        c.nomSociete,
        c.enseigne,
        c.siret,
        c.ville,
        c.codePostal,
        dm ? contactName(dm) : "",
        dm?.email,
        dm?.telephone,
        stageLabel.get(c.stage) ?? c.stage,
        c.priorite ? (prioriteLabel.get(c.priorite) ?? c.priorite) : "",
        c.potentiel ? (potentielLabel.get(c.potentiel) ?? c.potentiel) : "",
        c.canalPrefere,
        specialties,
        c.siteWeb,
        c.chiffreAffaires,
        day(c.datePremierContact),
        day(lastTouch),
        c.notes,
      ];
    }),
  ];
  return csvResponse(rows, "suivi");
}

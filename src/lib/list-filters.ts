import type { Prisma } from "@prisma/client";
import { SPECIALTY_FIELDS } from "@/lib/constants";

/**
 * Shared where-builders for the Suivi (companies) and Contacts list filters.
 * The pages and the CSV export route both read the same URL params, so the
 * export always matches exactly what the user is looking at.
 */

export type Sp = { [key: string]: string | string[] | undefined };

const str = (sp: Sp, key: string): string =>
  typeof sp[key] === "string" ? (sp[key] as string) : "";

const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });

export function buildCompanyWhere(sp: Sp): {
  where: Prisma.CompanyWhereInput;
  /** Filters minus the engagement gate — used to count what the gate hides. */
  and: Prisma.CompanyWhereInput[];
  all: boolean;
} {
  const societe = str(sp, "societe");
  const nom = str(sp, "nom");
  const contact = str(sp, "contact");
  const stage = str(sp, "stage");
  const priorite = str(sp, "priorite");
  const potentiel = str(sp, "potentiel");
  const canal = str(sp, "canal");
  const site = str(sp, "site");
  const specialite = str(sp, "specialite");
  const dept = str(sp, "dept");
  const all = sp.all === "1";

  const where: Prisma.CompanyWhereInput = {};
  // Suivi defaults to "hot" prospects — those Chris has actually engaged with
  // (a logged activity, or a recorded first/last contact). `?all=1` lifts it.
  const engagement: Prisma.CompanyWhereInput = {
    OR: [
      { activities: { some: {} } },
      { dernierContact: { not: null } },
      { datePremierContact: { not: null } },
    ],
  };
  const and: Prisma.CompanyWhereInput[] = [];
  // Société: company identity (name / enseigne / ville / SIRET / SIREN).
  if (societe) {
    and.push({
      OR: [
        { nomSociete: ci(societe) },
        { enseigne: ci(societe) },
        { ville: ci(societe) },
        { siret: { contains: societe } },
        { siren: { contains: societe } },
      ],
    });
  }
  // Nom + Contact match the SAME contact (one `some` with combined criteria),
  // so "Nom: Dupont" + "Contact: @gmail" means a single contact matching both.
  const contactAnd: Prisma.ContactWhereInput[] = [];
  if (nom) contactAnd.push({ OR: [{ prenom: ci(nom) }, { nom: ci(nom) }] });
  if (contact)
    contactAnd.push({
      OR: [{ email: ci(contact) }, { telephone: { contains: contact } }],
    });
  if (contactAnd.length) and.push({ contacts: { some: { AND: contactAnd } } });

  if (stage) where.stage = stage as Prisma.CompanyWhereInput["stage"];
  if (priorite)
    where.priorite = priorite as Prisma.CompanyWhereInput["priorite"];
  if (potentiel)
    where.potentiel = potentiel as Prisma.CompanyWhereInput["potentiel"];
  if (canal) where.canalPrefere = canal;
  if (SPECIALTY_FIELDS.some((s) => s.key === specialite)) {
    (where as Record<string, unknown>)[specialite] = true;
  }
  if (/^\d{2}$/.test(dept)) where.codePostal = { startsWith: dept };
  // "Avec / sans site web" — treat empty strings the same as null.
  if (site === "with") {
    and.push({ siteWeb: { not: null } }, { siteWeb: { not: "" } });
  } else if (site === "without") {
    and.push({ OR: [{ siteWeb: null }, { siteWeb: "" }] });
  }
  // The engagement gate applies unless the user asked to see everything.
  where.AND = all ? and : [engagement, ...and];

  return { where, and, all };
}

export function buildContactWhere(sp: Sp): Prisma.ContactWhereInput {
  const societe = str(sp, "societe");
  const nom = str(sp, "nom");
  const contact = str(sp, "contact");
  const role = str(sp, "role");
  const has = str(sp, "has");
  const site = str(sp, "site");

  // Each active filter is one AND clause — "present" means non-null and non-empty.
  // The three text filters combine with each other and with the dropdowns.
  const and: Prisma.ContactWhereInput[] = [];
  if (nom)
    and.push({
      OR: [{ prenom: ci(nom) }, { nom: ci(nom) }, { fonction: ci(nom) }],
    });
  if (contact)
    and.push({
      OR: [{ email: ci(contact) }, { telephone: { contains: contact } }],
    });
  if (societe)
    and.push({
      company: { OR: [{ nomSociete: ci(societe) }, { enseigne: ci(societe) }] },
    });
  if (role === "decideur") and.push({ isDecisionMaker: true });
  if (has === "email") and.push({ email: { not: null } }, { email: { not: "" } });
  if (has === "phone")
    and.push({ telephone: { not: null } }, { telephone: { not: "" } });
  if (has === "linkedin")
    and.push({ linkedinUrl: { not: null } }, { linkedinUrl: { not: "" } });
  if (site === "with")
    and.push(
      { company: { siteWeb: { not: null } } },
      { company: { siteWeb: { not: "" } } },
    );
  if (site === "without")
    and.push({ company: { OR: [{ siteWeb: null }, { siteWeb: "" }] } });

  return and.length ? { AND: and } : {};
}

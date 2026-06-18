import type { Prisma, PrismaClient } from "@prisma/client";

// Enrichment via the official French open company API (no key required).
// Public registry data keyed by SIREN — fills company-level fields and creates
// director (dirigeant) contacts. Website / email / phone are NOT provided here.

const API = "https://recherche-entreprises.api.gouv.fr/search";

interface ApiDirigeant {
  nom?: string;
  prenoms?: string;
  qualite?: string | null;
  denomination?: string;
  type_dirigeant?: string;
}
interface ApiSiege {
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
}
interface ApiResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string | null;
  date_creation?: string;
  libelle_activite_principale?: string;
  siege?: ApiSiege;
  dirigeants?: ApiDirigeant[];
}
interface ApiResponse {
  results?: ApiResult[];
}

export interface EnrichResult {
  found: boolean;
  name: string | null;
  fieldsUpdated: string[];
  contactsAdded: number;
}

export async function fetchUniteLegale(
  siren: string,
): Promise<ApiResult | null> {
  const url = `${API}?q=${encodeURIComponent(siren)}&page=1&per_page=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as ApiResponse;
  const results = data.results ?? [];
  return results.find((r) => r.siren === siren) ?? results[0] ?? null;
}

/**
 * Enrich a single company in place. Only fills fields that are currently empty
 * (never overwrites data you've entered) and adds director contacts that don't
 * already exist.
 */
export async function enrichCompany(
  prisma: PrismaClient,
  companyId: string,
): Promise<EnrichResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { contacts: true },
  });
  if (!company?.siren) {
    return { found: false, name: null, fieldsUpdated: [], contactsAdded: 0 };
  }

  const r = await fetchUniteLegale(company.siren);
  if (!r) {
    return {
      found: false,
      name: company.nomSociete,
      fieldsUpdated: [],
      contactsAdded: 0,
    };
  }

  const update: Prisma.CompanyUpdateInput = {};
  const fields: string[] = [];

  if (!company.nomSociete && r.nom_complet) {
    update.nomSociete = r.nom_complet;
    fields.push("nomSociete");
  }
  if (!company.adresse && r.siege?.adresse) {
    update.adresse = r.siege.adresse;
    fields.push("adresse");
  }
  if (!company.ville && r.siege?.libelle_commune) {
    update.ville = r.siege.libelle_commune;
    fields.push("ville");
  }
  if (!company.codePostal && r.siege?.code_postal) {
    update.codePostal = r.siege.code_postal;
    fields.push("codePostal");
  }
  if (!company.libelleNaf && r.libelle_activite_principale) {
    update.libelleNaf = r.libelle_activite_principale;
    fields.push("libelleNaf");
  }
  if (!company.dateCreation && r.date_creation) {
    const d = new Date(r.date_creation);
    if (!Number.isNaN(d.getTime())) {
      update.dateCreation = d;
      fields.push("dateCreation");
    }
  }

  if (fields.length > 0) {
    await prisma.company.update({ where: { id: companyId }, data: update });
  }

  // Director contacts — real people only (skip "personne morale" companies).
  let contactsAdded = 0;
  const persons = (r.dirigeants ?? []).filter(
    (d) => d.type_dirigeant === "personne physique" || (d.nom && !d.denomination),
  );
  for (const d of persons) {
    const nom = d.nom?.trim() || null;
    const prenom = d.prenoms?.trim().split(/\s+/)[0] || null;
    if (!nom && !prenom) continue;
    const exists = company.contacts.some(
      (c) => (c.nom ?? "") === (nom ?? "") && (c.prenom ?? "") === (prenom ?? ""),
    );
    if (exists) continue;
    await prisma.contact.create({
      data: {
        companyId,
        nom,
        prenom,
        fonction: d.qualite || "Dirigeant",
      },
    });
    contactsAdded++;
  }

  return {
    found: true,
    name: (update.nomSociete as string | undefined) ?? company.nomSociete,
    fieldsUpdated: fields,
    contactsAdded,
  };
}

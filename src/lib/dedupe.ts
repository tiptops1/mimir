import type { PrismaClient } from "@prisma/client";

// Duplicate detection (P2.2). Deliberately conservative: exact-match grouping
// on normalized keys only — no fuzzy scoring — so every surfaced group is a
// real duplicate a human confirms before merging. SIRET is unique, so company
// dupes come from hand-added rows (MANUEL-… placeholder SIRET) shadowing a
// registry row, or two rows sharing a website domain.

export interface DupCompany {
  id: string;
  label: string;
  siret: string;
  ville: string | null;
  stage: string;
  contacts: number;
  activities: number;
  createdAt: Date;
}

export interface DupContact {
  id: string;
  name: string;
  email: string;
  companyId: string;
  companyLabel: string;
  activities: number;
  createdAt: Date;
}

export interface DupGroup<T> {
  key: string; // what matched (shown in the UI)
  kind: "name" | "domain" | "email";
  rows: T[];
}

const LEGAL_FORMS =
  /\b(sarl|sasu|sas|eurl|sa|sci|snc|selarl|selas|scop|scp|ei|eirl)\b/g;

/** Company-name normalization: accents/case/punctuation/legal forms out. */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Bare host of a website URL ("https://www.axa.fr/x" → "axa.fr"). */
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export async function findDuplicateCompanies(
  prisma: PrismaClient,
): Promise<Array<DupGroup<DupCompany>>> {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
      siret: true,
      siteWeb: true,
      ville: true,
      stage: true,
      createdAt: true,
      _count: { select: { contacts: true, activities: true } },
    },
  });

  const toRow = (c: (typeof companies)[number]): DupCompany => ({
    id: c.id,
    label: c.enseigne || c.nomSociete || c.siret,
    siret: c.siret,
    ville: c.ville,
    stage: c.stage,
    contacts: c._count.contacts,
    activities: c._count.activities,
    createdAt: c.createdAt,
  });

  const groups: Array<DupGroup<DupCompany>> = [];
  const seen = new Set<string>(); // id-set signatures, so name+domain don't double-report

  const push = (kind: "name" | "domain", key: string, rows: typeof companies) => {
    const signature = rows
      .map((r) => r.id)
      .sort()
      .join("|");
    if (seen.has(signature)) return;
    seen.add(signature);
    groups.push({ kind, key, rows: rows.map(toRow) });
  };

  const byName = groupBy(companies, (c) => {
    const n = normalizeCompanyName(c.enseigne || c.nomSociete);
    return n.length >= 5 ? n : ""; // too-short names over-group
  });
  for (const [key, rows] of byName) if (rows.length > 1) push("name", key, rows);

  const byDomain = groupBy(companies, (c) => normalizeDomain(c.siteWeb));
  for (const [key, rows] of byDomain) if (rows.length > 1) push("domain", key, rows);

  return groups;
}

export async function findDuplicateContacts(
  prisma: PrismaClient,
): Promise<Array<DupGroup<DupContact>>> {
  const contacts = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: {
      id: true,
      nom: true,
      prenom: true,
      email: true,
      companyId: true,
      createdAt: true,
      company: { select: { nomSociete: true, enseigne: true, siret: true } },
      _count: { select: { activities: true } },
    },
  });

  const groups: Array<DupGroup<DupContact>> = [];
  const byEmail = groupBy(contacts, (c) => (c.email ?? "").trim().toLowerCase());
  for (const [key, rows] of byEmail) {
    if (rows.length < 2) continue;
    groups.push({
      kind: "email",
      key,
      rows: rows.map((c) => ({
        id: c.id,
        name: [c.prenom, c.nom].filter(Boolean).join(" ") || key,
        email: key,
        companyId: c.companyId,
        companyLabel:
          c.company.enseigne || c.company.nomSociete || c.company.siret,
        activities: c._count.activities,
        createdAt: c.createdAt,
      })),
    });
  }
  return groups;
}

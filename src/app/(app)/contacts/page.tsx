import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState } from "@/components/ui";
import { ContactsFilters } from "@/components/contacts-filters";
import {
  companyName,
  contactName,
  personLinkedInSearch,
} from "@/lib/display";

const PAGE_SIZE = 25;

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const prisma = await getTenantDb();
  const sp = await searchParams;
  const societe = typeof sp.societe === "string" ? sp.societe : "";
  const nom = typeof sp.nom === "string" ? sp.nom : "";
  const contact = typeof sp.contact === "string" ? sp.contact : "";
  const role = typeof sp.role === "string" ? sp.role : "";
  const has = typeof sp.has === "string" ? sp.has : "";
  const site = typeof sp.site === "string" ? sp.site : "";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  // Each active filter is one AND clause — "present" means non-null and non-empty.
  // The three text filters combine with each other and with the dropdowns.
  const and: Prisma.ContactWhereInput[] = [];
  if (nom) and.push({ OR: [{ prenom: ci(nom) }, { nom: ci(nom) }, { fonction: ci(nom) }] });
  if (contact)
    and.push({ OR: [{ email: ci(contact) }, { telephone: { contains: contact } }] });
  if (societe)
    and.push({ company: { OR: [{ nomSociete: ci(societe) }, { enseigne: ci(societe) }] } });
  if (role === "decideur") and.push({ isDecisionMaker: true });
  if (has === "email") and.push({ email: { not: null } }, { email: { not: "" } });
  if (has === "phone") and.push({ telephone: { not: null } }, { telephone: { not: "" } });
  if (has === "linkedin")
    and.push({ linkedinUrl: { not: null } }, { linkedinUrl: { not: "" } });
  if (site === "with")
    and.push({ company: { siteWeb: { not: null } } }, { company: { siteWeb: { not: "" } } });
  if (site === "without")
    and.push({ company: { OR: [{ siteWeb: null }, { siteWeb: "" }] } });

  const where: Prisma.ContactWhereInput = and.length ? { AND: and } : {};

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: {
          select: {
            id: true,
            nomSociete: true,
            enseigne: true,
            siret: true,
            ville: true,
            siteWeb: true,
            chiffreAffaires: true,
          },
        },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = Boolean(societe || nom || contact || role || has || site);
  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (societe) params.set("societe", societe);
    if (nom) params.set("nom", nom);
    if (contact) params.set("contact", contact);
    if (role) params.set("role", role);
    if (has) params.set("has", has);
    if (site) params.set("site", site);
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total} contact${total > 1 ? "s" : ""}`}
      />
      <div className="p-6">
        <ContactsFilters />

        {contacts.length === 0 ? (
          <EmptyState
            title="Aucun contact"
            hint={
              hasFilters
                ? "Aucun contact ne correspond à ces filtres. Réinitialisez pour tout voir."
                : "Les contacts (dirigeants) s'ajoutent depuis la fiche d'une société."
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Société</th>
                    <th className="px-4 py-3 font-medium">Chiffre d&apos;affaires</th>
                    <th className="px-4 py-3 font-medium">Site web</th>
                    <th className="px-4 py-3 font-medium">Décideur</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">LinkedIn</th>
                    <th className="px-4 py-3 font-medium">Téléphone</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => {
                    const site = c.company.siteWeb;
                    const siteHref = site
                      ? site.startsWith("http")
                        ? site
                        : `https://${site}`
                      : null;
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-border last:border-0 hover:bg-surface-2/60"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/companies/${c.company.id}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {companyName(c.company)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {c.company.chiffreAffaires != null
                            ? euro.format(c.company.chiffreAffaires)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {siteHref ? (
                            <a
                              href={siteHref}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand hover:underline"
                            >
                              {site!.replace(/^https?:\/\//, "").replace(/^www\./, "")}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{contactName(c)}</td>
                        <td className="px-4 py-3 text-muted">
                          {c.email ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={
                              c.linkedinUrl ||
                              personLinkedInSearch(c, c.company)
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand hover:underline"
                          >
                            {c.linkedinUrl ? "Profil" : "Rechercher ↗"}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {c.telephone ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">
              Page {page} sur {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={qs({ page: page - 1 })}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-surface-2"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={qs({ page: page + 1 })}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-surface-2"
                >
                  Suivant
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

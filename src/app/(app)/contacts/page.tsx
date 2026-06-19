import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Input, Select } from "@/components/ui";
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
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const role = typeof sp.role === "string" ? sp.role : "";
  const has = typeof sp.has === "string" ? sp.has : "";
  const site = typeof sp.site === "string" ? sp.site : "";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  // Each active filter is one AND clause — "present" means non-null and non-empty.
  const and: Prisma.ContactWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { nom: { contains: q, mode: "insensitive" } },
        { prenom: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { fonction: { contains: q, mode: "insensitive" } },
      ],
    });
  }
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

  const hasFilters = Boolean(q || role || has || site);
  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
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
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Rechercher un contact…"
            />
          </div>
          <Select name="role" defaultValue={role} className="w-48">
            <option value="">Tous les contacts</option>
            <option value="decideur">Décideurs uniquement</option>
          </Select>
          <Select name="has" defaultValue={has} className="w-48">
            <option value="">Toutes coordonnées</option>
            <option value="email">Avec email</option>
            <option value="phone">Avec téléphone</option>
            <option value="linkedin">Avec LinkedIn</option>
          </Select>
          <Select name="site" defaultValue={site} className="w-48">
            <option value="">Site web : tous</option>
            <option value="with">Société avec site</option>
            <option value="without">Société sans site</option>
          </Select>
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Filtrer
          </button>
          {hasFilters && (
            <Link
              href="/contacts"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Réinitialiser
            </Link>
          )}
        </form>

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
                  <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
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
                        className="border-b border-border last:border-0 hover:bg-slate-50/60"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/companies/${c.company.id}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {companyName(c.company)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {c.company.chiffreAffaires != null
                            ? euro.format(c.company.chiffreAffaires)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
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
                        <td className="px-4 py-3 text-slate-600">
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
                        <td className="px-4 py-3 text-slate-600">
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
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={qs({ page: page + 1 })}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50"
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

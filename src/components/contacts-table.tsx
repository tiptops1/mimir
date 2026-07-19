import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { Card, EmptyState } from "@/components/ui";
import { RgpdCell } from "@/components/rgpd-cell";
import { companyName, contactName, personLinkedInSearch } from "@/lib/display";

const PAGE_SIZE = 25;

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export async function ContactsTable({
  where,
  page,
  hasFilters,
}: {
  where: Prisma.ContactWhereInput;
  page: number;
  hasFilters: boolean;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();

  const contacts = await prisma.contact.findMany({
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
  });

  if (contacts.length === 0) {
    return (
      <EmptyState
        title="Aucun contact"
        hint={
          hasFilters
            ? "Aucun contact ne correspond à ces filtres. Réinitialisez pour tout voir."
            : "Les contacts (dirigeants) s'ajoutent depuis la fiche d'une société."
        }
      />
    );
  }

  return (
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
              <th className="px-4 py-3 font-medium">RGPD</th>
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
                  <td className="px-4 py-3 text-muted">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={c.linkedinUrl || personLinkedInSearch(c, c.company)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      {c.linkedinUrl ? "Profil" : "Rechercher ↗"}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.telephone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <RgpdCell
                      contactId={c.id}
                      consent={c.consent}
                      isAdmin={session.role === "ADMIN"}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

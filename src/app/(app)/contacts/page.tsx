import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Input } from "@/components/ui";
import { companyName, contactName } from "@/lib/display";

const PAGE_SIZE = 25;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  const where: Prisma.ContactWhereInput = {};
  if (q) {
    where.OR = [
      { nom: { contains: q, mode: "insensitive" } },
      { prenom: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { fonction: { contains: q, mode: "insensitive" } },
    ];
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { id: true, nomSociete: true, enseigne: true, siret: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total} contact${total > 1 ? "s" : ""}`}
      />
      <div className="p-6">
        <form className="mb-4 flex gap-3">
          <div className="max-w-sm flex-1">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Rechercher un contact…"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Rechercher
          </button>
        </form>

        {contacts.length === 0 ? (
          <EmptyState
            title="Aucun contact"
            hint="Les contacts (dirigeants) s'ajoutent depuis la fiche d'une société."
          />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Nom</th>
                  <th className="px-4 py-3 font-medium">Fonction</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Téléphone</th>
                  <th className="px-4 py-3 font-medium">Société</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-4 py-3 font-medium">{contactName(c)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.fonction ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.telephone ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/companies/${c.company.id}`}
                        className="text-brand hover:underline"
                      >
                        {companyName(c.company)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}
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

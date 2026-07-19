import { ViewTransition } from "react";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { getStageDefs } from "@/lib/stage-config";
import { Card, EmptyState } from "@/components/ui";
import { companyName, contactName } from "@/lib/display";
import { PRIORITE_OPTIONS, POTENTIEL_OPTIONS, SPECIALTY_FIELDS } from "@/lib/constants";
import { SpecialtiesCell } from "@/components/specialties-cell";
import { NotesCell } from "@/components/notes-cell";
import { EnumCell } from "@/components/enum-cell";
import { BulkProvider, BulkHeaderCheckbox, BulkRowCheckbox } from "@/components/bulk-select";

const PAGE_SIZE = 20;

const PRIORITE_CELL_OPTIONS = PRIORITE_OPTIONS.map((p) => ({
  value: p.value,
  label: p.label,
  short: p.value,
  badge: p.badge,
}));
const POTENTIEL_CELL_OPTIONS = POTENTIEL_OPTIONS.map((p) => ({
  value: p.value,
  label: p.label,
}));

type DmContact = {
  nom: string | null;
  prenom: string | null;
  isDecisionMaker: boolean | null;
};

/** Pick the flagged decision-maker, else the first contact. */
function decisionMaker(contacts: DmContact[]) {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
}

/** Days-since-last-touch label — only when there's a clear touchpoint. */
function touchLabel(date: Date | null | undefined): { text: string; cls: string } {
  if (!date) return { text: "—", cls: "text-faint" };
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  const text = days <= 0 ? "Aujourd'hui" : days === 1 ? "Hier" : `Il y a ${days} j`;
  const cls = days <= 7 ? "text-emerald-600" : days <= 30 ? "text-amber-600" : "text-rose-600";
  return { text, cls };
}

export async function CompaniesTable({
  where,
  page,
  bulkSequences,
}: {
  where: Prisma.CompanyWhereInput;
  page: number;
  bulkSequences: { id: string; label: string }[];
}) {
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
  const stageOptions = stageDefs.map((s) => ({
    value: s.value,
    label: s.label,
    badge: s.badge,
    dot: s.dot,
  }));

  const companies = await prisma.company.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      _count: { select: { contacts: true } },
      contacts: {
        select: { nom: true, prenom: true, isDecisionMaker: true },
        orderBy: { createdAt: "asc" },
      },
      activities: {
        select: { date: true },
        orderBy: { date: "desc" },
        take: 1,
      },
    },
  });

  if (companies.length === 0) {
    return (
      <EmptyState
        title="Aucune société trouvée"
        hint="Ajustez vos filtres ou ajoutez une nouvelle société."
      />
    );
  }

  return (
    <BulkProvider
      pageIds={companies.map((c) => c.id)}
      stages={stageDefs.map((s) => ({ value: s.value, label: s.label }))}
      sequences={bulkSequences}
    >
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="w-10 px-4 py-2.5">
                  <BulkHeaderCheckbox />
                </th>
                <th className="px-4 py-2.5 font-semibold">Contact</th>
                <th className="px-4 py-2.5 font-semibold">Spécialités</th>
                <th className="px-4 py-2.5 font-semibold">Notes / prochaines étapes</th>
                <th className="px-4 py-2.5 font-semibold">Étape</th>
                <th className="px-4 py-2.5 font-semibold">Priorité</th>
                <th className="px-4 py-2.5 font-semibold">Potentiel</th>
                <th className="px-4 py-2.5 font-semibold">Dernier contact</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const dm = decisionMaker(c.contacts);
                const hasContact = Boolean(dm && (dm.prenom || dm.nom));
                const activeSpec = SPECIALTY_FIELDS.filter(
                  (f) => c[f.key as keyof typeof c],
                ).map((f) => f.key);
                const lastTouch = c.dernierContact ?? c.activities[0]?.date ?? null;
                const touch = touchLabel(lastTouch);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/70"
                  >
                    <td className="px-4 py-3">
                      <BulkRowCheckbox id={c.id} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/companies/${c.id}`}
                        className="block"
                        transitionTypes={["nav-forward"]}
                      >
                        {hasContact ? (
                          <>
                            <span className="font-medium text-foreground hover:text-brand">
                              {contactName(dm!)}
                            </span>
                            <ViewTransition name={`company-${c.id}`}>
                              <span className="mt-0.5 block text-xs text-muted">
                                {companyName(c)}
                              </span>
                            </ViewTransition>
                          </>
                        ) : (
                          <>
                            <ViewTransition name={`company-${c.id}`}>
                              <span className="font-medium text-foreground hover:text-brand">
                                {companyName(c)}
                              </span>
                            </ViewTransition>
                            <span className="mt-0.5 block text-xs text-faint tnum">
                              {c.siret}
                            </span>
                          </>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <SpecialtiesCell id={c.id} active={activeSpec} />
                    </td>
                    <td className="px-4 py-3">
                      <NotesCell id={c.id} value={c.notes} />
                    </td>
                    <td className="px-4 py-3">
                      <EnumCell id={c.id} field="stage" value={c.stage} options={stageOptions} />
                    </td>
                    <td className="px-4 py-3">
                      <EnumCell
                        id={c.id}
                        field="priorite"
                        value={c.priorite}
                        options={PRIORITE_CELL_OPTIONS}
                        nullable
                      />
                    </td>
                    <td className="px-4 py-3">
                      <EnumCell
                        id={c.id}
                        field="potentiel"
                        value={c.potentiel}
                        options={POTENTIEL_CELL_OPTIONS}
                        nullable
                      />
                    </td>
                    <td className={`px-4 py-3 text-xs font-medium ${touch.cls}`}>
                      {touch.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </BulkProvider>
  );
}

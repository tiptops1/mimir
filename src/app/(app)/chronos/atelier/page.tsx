import { Info } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import {
  DeactivatePersonButton,
  DeleteWorkLogButton,
  LogWorkForm,
  PersonForm,
} from "@/components/chronos/atelier-controls";
import { UNSOLD_WHERE } from "@/lib/chronos/inventory";
import { formatDuration, summariseLabour } from "@/lib/chronos/labour";
import { formatCents } from "@/lib/display";
import { formatDate } from "@/lib/utils";

/**
 * Chronos → Atelier (S24).
 *
 * S24 was originally "HR realm: hiring pipeline, onboarding docs, policy Q&A",
 * scoped for the inherited broker vertical. That vertical retired at B1, and a
 * recruitment funnel is not what a small buy/restore/resell business needs.
 * What it does need — and what nothing in the product did before — is to know
 * whose hours went into which watch, at what rate.
 *
 * That also closes a real hole: `ChronosConfig.labourRateCentsPerHour` was
 * seeded and read by nothing, and `LABOUR` was a UnitCost kind nothing wrote,
 * so every margin in the product valued restoration time at exactly zero.
 */

const KIND_LABEL: Record<string, string> = {
  EMPLOYEE: "Salarié",
  CONTRACTOR: "Prestataire",
  SELF: "Vous-même",
};

export default async function AtelierPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [people, logs, units, config] = await Promise.all([
    prisma.person.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.workLog.findMany({
      include: {
        person: { select: { id: true, name: true } },
        unit: { select: { id: true, sku: true, ref: { select: { brand: true, reference: true } } } },
      },
      orderBy: { performedAt: "desc" },
      take: 100,
    }),
    prisma.inventoryUnit.findMany({
      where: UNSOLD_WHERE,
      select: { id: true, sku: true, ref: { select: { brand: true, reference: true } } },
      orderBy: { sku: "asc" },
    }),
    prisma.chronosConfig.findUnique({
      where: { singleton: "default" },
      select: { labourRateCentsPerHour: true },
    }),
  ]);

  const summary = summariseLabour(
    logs.map((l) => ({
      personId: l.personId,
      personName: l.person.name,
      minutes: l.minutes,
      costCents: l.costCents,
    })),
  );

  const houseRate = config?.labourRateCentsPerHour ?? 0;

  return (
    <div>
      <PageHeader
        title="Atelier"
        subtitle="Intervenants et temps passé, imputé au coût réel de chaque montre"
        titleTransitionName="atelier-title"
      />

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi value={String(people.length)} label="Intervenants actifs" hint="atelier" />
          <Kpi
            value={formatDuration(summary.totalMinutes)}
            label="Temps enregistré"
            hint="100 dernières saisies"
          />
          <Kpi
            value={formatCents(summary.totalCostCents)}
            label="Main-d'œuvre imputée"
            hint="incluse dans la marge nette"
          />
          <Kpi
            value={formatCents(houseRate)}
            label="Taux de l'atelier"
            hint="par heure, si aucun taux personnel"
          />
        </div>

        <Card>
          <CardBody className="flex items-start gap-2 text-xs text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Chaque saisie crée une ligne de coût <strong>Main-d&apos;œuvre</strong> sur la montre
              concernée, au taux en vigueur <strong>au moment de la saisie</strong>. Augmenter un
              taux plus tard ne change donc jamais la marge d&apos;une montre déjà vendue.
            </span>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saisir du temps</CardTitle>
          </CardHeader>
          <CardBody>
            <LogWorkForm
              people={people.map((p) => ({ id: p.id, name: p.name }))}
              units={units.map((u) => ({
                id: u.id,
                label: `${u.sku} — ${u.ref.brand} ${u.ref.reference}`,
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intervenants</CardTitle>
            <PersonForm />
          </CardHeader>
          <CardBody className="p-0">
            {people.length === 0 ? (
              <EmptyState
                title="Aucun intervenant"
                hint="Ajoutez-vous vous-même pour commencer à valoriser votre temps."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-medium">Nom</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-right font-medium">Taux horaire</th>
                      <th className="px-4 py-2.5 text-right font-medium">Temps</th>
                      <th className="px-4 py-2.5 text-right font-medium">Coût</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => {
                      const roll = summary.byPerson.find((b) => b.personId === p.id);
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3 font-medium text-foreground">
                            {p.name}
                            {p.note ? (
                              <span className="block text-xs text-faint">{p.note}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone="neutral">{KIND_LABEL[p.kind] ?? p.kind}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right tnum text-muted">
                            {p.hourlyRateCents !== null ? (
                              formatCents(p.hourlyRateCents)
                            ) : (
                              <span className="text-faint">taux atelier</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum text-muted">
                            {roll ? formatDuration(roll.minutes) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tnum text-foreground">
                            {roll ? formatCents(roll.costCents) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <DeactivatePersonButton id={p.id} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dernières saisies</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {logs.length === 0 ? (
              <EmptyState title="Aucun temps saisi" hint="Le temps passé apparaîtra ici." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-medium">Date</th>
                      <th className="px-4 py-2.5 text-left font-medium">Intervenant</th>
                      <th className="px-4 py-2.5 text-left font-medium">Montre</th>
                      <th className="px-4 py-2.5 text-right font-medium">Durée</th>
                      <th className="px-4 py-2.5 text-right font-medium">Coût</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-muted">{formatDate(l.performedAt)}</td>
                        <td className="px-4 py-3 text-foreground">{l.person.name}</td>
                        <td className="px-4 py-3">
                          <span className="text-foreground">{l.unit.sku}</span>
                          <span className="block text-xs text-faint">
                            {l.unit.ref.brand} {l.unit.ref.reference}
                          </span>
                          {l.note ? (
                            <span className="block text-xs text-muted">{l.note}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tnum text-muted">
                          {formatDuration(l.minutes)}
                        </td>
                        <td className="px-4 py-3 text-right tnum text-foreground">
                          {formatCents(l.costCents)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DeleteWorkLogButton id={l.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ value, label, hint }: { value: string; label: string; hint: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-2xl font-semibold tracking-tight tnum">{value}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-faint">{hint}</p>
      </CardBody>
    </Card>
  );
}

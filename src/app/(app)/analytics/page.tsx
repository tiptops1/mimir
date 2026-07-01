import Link from "next/link";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import {
  HorizontalBars,
  VerticalBars,
  DualBars,
  Donut,
  type ChartDatum,
} from "@/components/charts";
import { computeAnalyticsV2 } from "@/lib/analytics-v2";
import { FunnelChart, type FunnelDatum } from "@/components/funnel-chart";
import {
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  SPECIALTY_FIELDS,
} from "@/lib/constants";
import { getStageDefs } from "@/lib/stage-config";

const STAGE_HEX: Record<string, string> = {
  A_QUALIFIER: "#94a3b8",
  A_CONTACTER: "#38bdf8",
  CONTACTE: "#818cf8",
  RDV_OBTENU: "#a78bfa",
  DEMO_REALISEE: "#fbbf24",
  PROPOSITION_ENVOYEE: "#fb923c",
  GAGNE: "#10b981",
  PERDU: "#fb7185",
};

const DEPT_NAMES: Record<string, string> = {
  "22": "Côtes-d'Armor",
  "29": "Finistère",
  "35": "Ille-et-Vilaine",
  "56": "Morbihan",
};

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <CardBody>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </CardBody>
  );
  if (href) {
    return (
      <Card className="transition-colors hover:border-brand/40 hover:bg-surface-2/60">
        <Link href={href}>{inner}</Link>
      </Card>
    );
  }
  return <Card>{inner}</Card>;
}

export default async function AnalyticsPage() {
  await verifySession();
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
  const v2 = await computeAnalyticsV2(prisma, stageDefs);

  const companies = await prisma.company.findMany({
    select: {
      stage: true,
      priorite: true,
      potentiel: true,
      codePostal: true,
      icpScore: true,
      specialiteSante: true,
      specialitePrevoyance: true,
      specialiteIard: true,
      specialiteAuto: true,
      specialiteRcPro: true,
      specialiteEntreprises: true,
      specialiteCollectives: true,
      specialiteParticuliers: true,
    },
  });

  const total = companies.length;

  // Stage funnel
  const stageCounts = new Map<string, number>();
  for (const c of companies)
    stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1);
  const stageData: FunnelDatum[] = stageDefs.map((s) => ({
    name: s.label,
    value: stageCounts.get(s.value) ?? 0,
    color: STAGE_HEX[s.value],
    stage: s.value,
  }));

  // Priorité
  const prioriteData: ChartDatum[] = PRIORITE_OPTIONS.map((p) => ({
    name: `Priorité ${p.value}`,
    value: companies.filter((c) => c.priorite === p.value).length,
    color: p.value === "A" ? "#f43f5e" : p.value === "B" ? "#f59e0b" : "#94a3b8",
    href: `/companies?priorite=${p.value}`,
  }));
  const prioriteData2 = [
    ...prioriteData,
    {
      name: "Non définie",
      value: companies.filter((c) => !c.priorite).length,
      color: "#e2e8f0",
    },
  ].filter((d) => d.value > 0);

  // Potentiel
  const potentielData: ChartDatum[] = POTENTIEL_OPTIONS.map((p, i) => ({
    name: p.label,
    value: companies.filter((c) => c.potentiel === p.value).length,
    color: ["#cbd5e1", "#818cf8", "#4f46e5"][i],
    href: `/companies?potentiel=${p.value}`,
  }));
  const potentielData2 = [
    ...potentielData,
    {
      name: "Non défini",
      value: companies.filter((c) => !c.potentiel).length,
      color: "#e2e8f0",
    },
  ].filter((d) => d.value > 0);

  // Specialty coverage
  const specialtyData: ChartDatum[] = SPECIALTY_FIELDS.map((f) => ({
    name: f.label,
    value: companies.filter((c) => c[f.key as keyof typeof c]).length,
    href: `/companies?specialite=${f.key}`,
  })).filter((d) => d.value > 0);

  // Departments (first 2 digits of code postal)
  const deptCounts = new Map<string, number>();
  for (const c of companies) {
    if (!c.codePostal) continue;
    const dep = c.codePostal.slice(0, 2);
    deptCounts.set(dep, (deptCounts.get(dep) ?? 0) + 1);
  }
  const departmentData: ChartDatum[] = [...deptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([dep, value]) => ({
      name: DEPT_NAMES[dep] ?? `Dép. ${dep}`,
      value,
      color: "#6366f1",
      href: `/companies?dept=${dep}`,
    }));

  // KPIs
  const gagne = stageCounts.get("GAGNE") ?? 0;
  const perdu = stageCounts.get("PERDU") ?? 0;
  const enCours = total - gagne - perdu;
  const conversion = total > 0 ? Math.round((gagne / total) * 100) : 0;
  const withIcp = companies.filter((c) => c.icpScore != null);
  const avgIcp =
    withIcp.length > 0
      ? Math.round(
          withIcp.reduce((s, c) => s + (c.icpScore ?? 0), 0) / withIcp.length,
        )
      : 0;

  return (
    <div>
      <PageHeader
        title="Analytique"
        subtitle="Vue d'ensemble de la prospection"
      />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Sociétés"
            value={total}
            sub="dans le CRM"
            href="/companies"
          />
          <StatCard label="En cours" value={enCours} sub="hors gagné/perdu" />
          <StatCard
            label="Taux de conversion"
            value={`${conversion}%`}
            sub={`${gagne} gagné(s)`}
            href="/companies?stage=GAGNE"
          />
          <StatCard
            label="Score ICP moyen"
            value={avgIcp || "—"}
            sub={`${withIcp.length} scoré(s)`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Entonnoir par étape</CardTitle>
          </CardHeader>
          <CardBody>
            <FunnelChart data={stageData} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Répartition par priorité</CardTitle>
            </CardHeader>
            <CardBody>
              <Donut data={prioriteData2} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Répartition par potentiel</CardTitle>
            </CardHeader>
            <CardBody>
              <Donut data={potentielData2} />
            </CardBody>
          </Card>
        </div>

        {/* — Analytics v2: the time dimension (StageChange transition log) — */}
        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Dynamique du pipeline
        </h2>
        {!v2.hasHistory && (
          <p className="-mt-4 text-xs text-faint">
            L&apos;historique des changements d&apos;étape se construit à partir
            d&apos;aujourd&apos;hui — vélocité et conversions s&apos;affinent au fil
            des mouvements du pipeline.
          </p>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Temps moyen dans l&apos;étape (jours)</CardTitle>
            </CardHeader>
            <CardBody>
              <HorizontalBars
                data={v2.dwell.map((d) => ({
                  name: d.label,
                  value: d.avgDays,
                  color: STAGE_HEX[d.stage],
                }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Volume d&apos;activités (12 semaines)</CardTitle>
            </CardHeader>
            <CardBody>
              <VerticalBars data={v2.weeklyActivity} />
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Conversions entre étapes (90 jours)</CardTitle>
            </CardHeader>
            <CardBody>
              {v2.transitions.length > 0 ? (
                <HorizontalBars
                  data={v2.transitions.map((t) => ({
                    name: t.label,
                    value: t.count,
                  }))}
                />
              ) : (
                <p className="py-12 text-center text-sm text-muted">
                  Aucun changement d&apos;étape enregistré sur les 90 derniers
                  jours.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gagnés vs perdus par mois</CardTitle>
            </CardHeader>
            <CardBody>
              {v2.winTrend.length > 0 ? (
                <DualBars data={v2.winTrend} />
              ) : (
                <p className="py-12 text-center text-sm text-muted">
                  Aucune issue (gagné/perdu) enregistrée sur les 6 derniers mois.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Sociétés par département</CardTitle>
            </CardHeader>
            <CardBody>
              <HorizontalBars data={departmentData} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Couverture des spécialités</CardTitle>
            </CardHeader>
            <CardBody>
              {specialtyData.length > 0 ? (
                <HorizontalBars data={specialtyData} />
              ) : (
                <p className="py-12 text-center text-sm text-muted">
                  Aucune spécialité renseignée pour le moment.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

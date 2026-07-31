import { Info } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import {
  DeactivateWatchButton,
  RejectCandidateButton,
  WatchForm,
} from "@/components/chronos/sourcing-controls";
import { formatCents } from "@/lib/display";
import { cn } from "@/lib/utils";

/**
 * Chronos → Sourcing (Kairos, S32).
 *
 * Two surfaces: the watchlist (what he hunts, and how hard) and the scored
 * listings the last scan produced.
 *
 * The listings table deliberately shows what was PASSED OVER as well as what
 * was proposed. An agent that only ever surfaces its own hits is unauditable —
 * seeing that a "for parts" listing was vetoed, or that something was 40 € over
 * the ceiling, is how he learns whether the parameters are right.
 *
 * Approving happens in the Heimdallr inbox, not here: a buy offer is a
 * side-effectful money decision and goes through the one bridge (D5). Approval
 * records a ceiling — Chronos never places a bid.
 */

const VERDICT_LABEL: Record<string, string> = {
  candidate: "Candidate",
  too_expensive: "Trop chère",
  vetoed: "Écartée",
  no_comp: "Sans comparable",
};

const VERDICT_TONE: Record<string, "success" | "neutral" | "danger" | "warning"> = {
  candidate: "success",
  too_expensive: "neutral",
  vetoed: "danger",
  no_comp: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Nouvelle",
  PROPOSED: "En attente d'approbation",
  APPROVED: "Approuvée",
  REJECTED: "Écartée",
  QUARANTINED: "Mise en quarantaine",
};

type Flag = { key: string; label: string; severity: string };

export default async function SourcingPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [watches, candidates, refs] = await Promise.all([
    prisma.sourcingWatch.findMany({
      where: { active: true },
      include: { ref: { select: { brand: true, reference: true, model: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.sourcingCandidate.findMany({
      include: { ref: { select: { brand: true, reference: true } } },
      orderBy: [{ score: "desc" }, { scannedAt: "desc" }],
      take: 100,
    }),
    prisma.productRef.findMany({
      select: { id: true, brand: true, reference: true, model: true },
      orderBy: [{ brand: "asc" }, { reference: "asc" }],
    }),
  ]);

  const refOptions = refs.map((r) => ({
    id: r.id,
    label: `${r.brand} ${r.reference}${r.model ? ` · ${r.model}` : ""}`,
  }));

  const liveCandidates = candidates.filter(
    (c) => c.verdict === "candidate" && c.status !== "REJECTED",
  );

  return (
    <div>
      <PageHeader
        title="Sourcing"
        subtitle="Références suivies et annonces évaluées contre vos ventes réalisées"
        titleTransitionName="sourcing-title"
      />

      <div className="space-y-6 p-6">
        <Card>
          <CardBody className="flex items-start gap-2 text-xs text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Le plafond d&apos;achat est calculé sur le prix auquel{" "}
              <strong>vous avez réellement revendu</strong> la référence, moins les frais, la
              restauration et votre marge cible — jamais sur les prix demandés par d&apos;autres
              vendeurs. Une offre approuvée enregistre ce plafond&nbsp;:{" "}
              <strong>Chronos ne place jamais d&apos;enchère à votre place.</strong>
            </span>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Références suivies</CardTitle>
            <WatchForm refs={refOptions} />
          </CardHeader>
          <CardBody className="p-0">
            {watches.length === 0 ? (
              <EmptyState
                title="Aucune référence suivie"
                hint="Ajoutez une référence pour que Kairos surveille les annonces la concernant."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-medium">Référence</th>
                      <th className="px-4 py-2.5 text-right font-medium">Restauration</th>
                      <th className="px-4 py-2.5 text-right font-medium">Plafond</th>
                      <th className="px-4 py-2.5 text-left font-medium">Note</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {watches.map((w) => (
                      <tr key={w.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {w.ref.brand} {w.ref.reference}
                          {w.ref.model ? (
                            <span className="block text-xs text-faint">{w.ref.model}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tnum text-muted">
                          {formatCents(w.refurbCostCents)}
                        </td>
                        <td className="px-4 py-3 text-right tnum text-muted">
                          {w.maxPricePct !== null ? `${w.maxPricePct} %` : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted">{w.note || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <DeactivateWatchButton refId={w.refId} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Annonces évaluées</CardTitle>
            <Badge tone={liveCandidates.length > 0 ? "success" : "neutral"}>
              {liveCandidates.length} candidate(s)
            </Badge>
          </CardHeader>
          <CardBody className="p-0">
            {candidates.length === 0 ? (
              <EmptyState
                title="Aucune annonce évaluée"
                hint="Lancez un scan pour que Kairos évalue les annonces en cours."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-medium">Annonce</th>
                      <th className="px-4 py-2.5 text-right font-medium">Demandé</th>
                      <th className="px-4 py-2.5 text-right font-medium">Plafond</th>
                      <th className="px-4 py-2.5 text-right font-medium">Marge dispo.</th>
                      <th className="px-4 py-2.5 text-left font-medium">Verdict</th>
                      <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const flags = (c.flags ?? []) as Flag[];
                      return (
                        <tr key={c.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <div className="max-w-xs truncate font-medium text-foreground">
                              {c.url ? (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                >
                                  {c.title}
                                </a>
                              ) : (
                                c.title
                              )}
                            </div>
                            <div className="text-xs text-faint">
                              {c.ref.brand} {c.ref.reference} · {c.provider}
                            </div>
                            {flags.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {flags.map((f) => (
                                  <span
                                    key={f.key}
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px]",
                                      f.severity === "veto"
                                        ? "bg-danger-subtle text-danger"
                                        : "bg-warning-subtle text-warning",
                                    )}
                                  >
                                    {f.label}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right tnum text-foreground">
                            {formatCents(c.askPriceCents)}
                          </td>
                          <td className="px-4 py-3 text-right tnum text-muted">
                            {c.maxBidCents !== null ? formatCents(c.maxBidCents) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right tnum",
                              (c.headroomCents ?? 0) > 0 ? "text-success" : "text-muted",
                            )}
                          >
                            {/* No ceiling means headroom is undefined, not zero
                                — a vetoed listing has no margin to speak of,
                                and "0,00 €" would read as a real number. */}
                            {c.maxBidCents !== null && c.headroomCents !== null
                              ? formatCents(c.headroomCents)
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={VERDICT_TONE[c.verdict] ?? "neutral"}>
                              {VERDICT_LABEL[c.verdict] ?? c.verdict}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {STATUS_LABEL[c.status] ?? c.status}
                            {c.approvedBidCents !== null ? (
                              <span className="block tnum text-success">
                                {formatCents(c.approvedBidCents)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {c.status === "NEW" ? (
                              <RejectCandidateButton candidateId={c.id} />
                            ) : null}
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
      </div>
    </div>
  );
}

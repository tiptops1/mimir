import { Badge } from "@/components/ui";
import { PRIORITE_OPTIONS, POTENTIEL_OPTIONS } from "@/lib/constants";
import { stageMetaFrom, type StageDef } from "@/lib/stage-meta";

export function StageBadge({ stage, stageDefs }: { stage: string; stageDefs: StageDef[] }) {
  const meta = stageMetaFrom(stageDefs, stage);
  return (
    <Badge className={meta.badge}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
}

export function PrioriteBadge({ priorite }: { priorite: string | null }) {
  if (!priorite) return <span className="text-slate-300">—</span>;
  const opt = PRIORITE_OPTIONS.find((p) => p.value === priorite);
  if (!opt) return <span className="text-slate-300">—</span>;
  return <Badge className={opt.badge}>{opt.value}</Badge>;
}

export function PotentielBadge({ potentiel }: { potentiel: string | null }) {
  if (!potentiel) return <span className="text-slate-300">—</span>;
  const opt = POTENTIEL_OPTIONS.find((p) => p.value === potentiel);
  return (
    <Badge className="bg-slate-100 text-slate-600">{opt?.label ?? potentiel}</Badge>
  );
}

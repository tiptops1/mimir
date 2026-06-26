import { getTenantDb } from "@/lib/tenant-context";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { StageEditorList, type StageDefRow } from "@/components/stage-editor-list";

export default async function SettingsStagesPage() {
  const prisma = await getTenantDb();
  const rows = await prisma.stageDefinition.findMany({ orderBy: { order: "asc" } });

  const stages: StageDefRow[] = rows.map((r) => ({
    id: r.id,
    value: r.key,
    label: r.label,
    order: r.order,
    accent: r.accentClass,
    badge: r.badgeClass,
    dot: r.dotClass,
    isWon: r.isWon,
    isLost: r.isLost,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Étapes du pipeline</CardTitle>
      </CardHeader>
      <CardBody>
        <StageEditorList initial={stages} />
      </CardBody>
    </Card>
  );
}

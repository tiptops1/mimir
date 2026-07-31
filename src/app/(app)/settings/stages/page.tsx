import Link from "next/link";
import { getTenantDb } from "@/lib/tenant-context";
import { getTenantProfile } from "@/lib/tenant-profile";
import { hasModule } from "@/lib/modules";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { StageEditorList, type StageDefRow } from "@/components/stage-editor-list";
import { STAGE_ENTITY_VOCAB, type StageEntity } from "@/lib/stage-meta";
import { str } from "@/lib/list-filters";
import { cn } from "@/lib/utils";

/**
 * Stage editor, entity-aware since S31.
 *
 * Before the scoping, this page could only ever show COMPANY stages — which
 * meant a Chronos-only tenant opened "Étapes" and found it EMPTY, since
 * seedChronosConfig withholds the broker pipeline. The switcher below is what
 * makes the tab useful to the actual customer: it edits the workshop
 * lifecycle (Acquise → En atelier → Prête → En vente → Vendue).
 *
 * Which entities appear is driven by the tenant's modules, not hardcoded —
 * src/components/settings-tabs.tsx has no module awareness, so this page is
 * where that judgement has to live.
 */
export default async function SettingsStagesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const prisma = await getTenantDb();
  const profile = await getTenantProfile();
  const sp = await searchParams;

  const available: StageEntity[] = [];
  if (hasModule(profile.modules, "crm")) available.push("COMPANY");
  if (hasModule(profile.modules, "chronos")) available.push("INVENTORY_UNIT");
  // A tenant with neither module still gets the company pipeline rather than a
  // blank page — the same fallback posture as loadStageDefs.
  if (available.length === 0) available.push("COMPANY");

  const requested = str(sp, "entity")?.toUpperCase();
  const entity: StageEntity =
    available.find((e) => e === requested) ?? available[0];

  const rows = await prisma.stageDefinition.findMany({
    where: { entity },
    orderBy: { order: "asc" },
  });

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
        <CardTitle>{STAGE_ENTITY_VOCAB[entity].title}</CardTitle>
        {available.length > 1 ? (
          <nav className="flex gap-1">
            {available.map((e) => (
              <Link
                key={e}
                href={`/settings/stages?entity=${e}`}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  e === entity
                    ? "bg-realm-subtle text-realm"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {STAGE_ENTITY_VOCAB[e].tab}
              </Link>
            ))}
          </nav>
        ) : null}
      </CardHeader>
      <CardBody>
        <StageEditorList key={entity} initial={stages} entity={entity} />
      </CardBody>
    </Card>
  );
}

import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, EmptyState, LinkButton } from "@/components/ui";
import { parseSteps } from "@/lib/sequences";

// Outreach sequence list — the admin surface for the cold-email machine's
// cadences. Editing lives on /outreach/sequences/[id]; writes are ADMIN-gated
// in the server actions (the page itself is visible to all, like /settings).

export default async function OutreachSequencesPage() {
  await verifySession();
  const prisma = await getTenantDb();
  const sequences = await prisma.sequence.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { enrollments: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Séquences"
        subtitle="Les cadences d'emails et de relances du moteur outreach"
      >
        <LinkButton href="/outreach/sequences/new">Nouvelle séquence</LinkButton>
      </PageHeader>

      <div className="space-y-3 p-4 sm:p-6">
        {sequences.length === 0 ? (
          <EmptyState
            title="Aucune séquence"
            hint="Créez votre première cadence — ex. 4 emails sur 14 jours ouvrés."
          />
        ) : (
          sequences.map((s) => {
            const steps = parseSteps(s.steps);
            return (
              <Link key={s.id} href={`/outreach/sequences/${s.id}`}>
                <Card className="mb-3 transition-colors hover:border-border-strong">
                  <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {s.name}
                      </p>
                      <p className="text-xs text-muted">
                        {steps.length} étape{steps.length > 1 ? "s" : ""}
                        {steps.length > 0 &&
                          ` · J+0 → J+${steps[steps.length - 1].offsetDays}`}
                        {" · "}
                        {s._count.enrollments} inscrite
                        {s._count.enrollments > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.mode === "AUTO_EMAIL" ? "brand" : "neutral"}>
                        {s.mode === "AUTO_EMAIL"
                          ? "Envoi auto"
                          : "Tâches manuelles"}
                      </Badge>
                      <Badge tone={s.active ? "success" : "neutral"}>
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

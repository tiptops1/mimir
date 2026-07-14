import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { SequenceEditor } from "@/components/outreach/sequence-editor";
import { parseSteps, type SequenceMode } from "@/lib/sequences";

export default async function EditOutreachSequencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const prisma = await getTenantDb();
  const seq = await prisma.sequence.findUnique({ where: { id } });
  if (!seq) notFound();

  return (
    <div>
      <PageHeader
        title={seq.name}
        subtitle="Délais en jours ouvrés — J+0 est le jour de l'inscription"
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <SequenceEditor
          initial={{
            id: seq.id,
            name: seq.name,
            mode: (seq.mode === "AUTO_EMAIL" ? "AUTO_EMAIL" : "TASKS") as SequenceMode,
            active: seq.active,
            steps: parseSteps(seq.steps),
          }}
        />
      </div>
    </div>
  );
}

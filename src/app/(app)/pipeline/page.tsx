import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { PipelineBoard, type PipelineCard } from "@/components/pipeline-board";
import { companyName, contactName } from "@/lib/display";
import { getStageDefs } from "@/lib/stage-config";
import { getTenantConfig } from "@/lib/tenant-config";

type StageValue = string;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
  const sp = await searchParams;
  const rawStage = typeof sp.stage === "string" ? sp.stage : "";
  const highlight = stageDefs.some((s) => s.value === rawStage)
    ? (rawStage as StageValue)
    : null;

  const companies = await prisma.company.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
      siret: true,
      ville: true,
      priorite: true,
      potentiel: true,
      stage: true,
      dernierContact: true,
      contacts: {
        select: {
          prenom: true,
          nom: true,
          email: true,
          telephone: true,
          isDecisionMaker: true,
        },
      },
      activities: { select: { date: true }, orderBy: { date: "desc" }, take: 1 },
      tasks: { where: { done: false }, select: { id: true }, take: 1 },
    },
  });

  const initial: Record<StageValue, PipelineCard[]> = Object.fromEntries(
    stageDefs.map((s) => [s.value, [] as PipelineCard[]]),
  ) as Record<StageValue, PipelineCard[]>;

  for (const c of companies) {
    // Prefer the decision-maker, else the first contact, as the card's lead person.
    const lead =
      c.contacts.find((ct) => ct.isDecisionMaker) ?? c.contacts[0] ?? null;
    const lastTouch = c.dernierContact ?? c.activities[0]?.date ?? null;
    const card: PipelineCard = {
      id: c.id,
      fields: {
        contact: lead ? contactName(lead) : null,
        company: companyName(c),
        ville: c.ville,
      },
      priorite: c.priorite,
      potentiel: c.potentiel,
      lastTouch: lastTouch ? lastTouch.toISOString() : null,
      hasOpenTask: c.tasks.length > 0,
      // Haystacks across ALL contacts so the board's filters match any of them.
      search: {
        societe: [companyName(c), c.ville, c.siret]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        nom: c.contacts
          .map((ct) => `${ct.prenom ?? ""} ${ct.nom ?? ""}`)
          .join(" ")
          .toLowerCase(),
        contact: c.contacts
          .map((ct) => `${ct.email ?? ""} ${ct.telephone ?? ""}`)
          .join(" ")
          .toLowerCase(),
      },
    };
    (initial[c.stage] ?? initial[stageDefs[0].value]).push(card);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Pipeline"
        subtitle="Glissez-déposez les sociétés entre les étapes"
      >
        <LinkButton href="/contacts/new">+ Nouveau contact</LinkButton>
      </PageHeader>
      <PipelineBoard
        initial={initial}
        total={companies.length}
        highlight={highlight}
        cardConfig={getTenantConfig().pipelineCard}
        stages={stageDefs}
      />
    </div>
  );
}

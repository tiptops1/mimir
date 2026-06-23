import { prisma } from "@/lib/db";
import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { PipelineBoard, type PipelineCard } from "@/components/pipeline-board";
import { companyName, contactName } from "@/lib/display";
import { PIPELINE_STAGES, type StageValue } from "@/lib/constants";
import { getTenantConfig } from "@/lib/tenant-config";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const sp = await searchParams;
  const rawStage = typeof sp.stage === "string" ? sp.stage : "";
  const highlight = PIPELINE_STAGES.some((s) => s.value === rawStage)
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
      contacts: {
        select: {
          prenom: true,
          nom: true,
          email: true,
          telephone: true,
          isDecisionMaker: true,
        },
      },
    },
  });

  const initial: Record<StageValue, PipelineCard[]> = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s.value, [] as PipelineCard[]]),
  ) as Record<StageValue, PipelineCard[]>;

  for (const c of companies) {
    // Prefer the decision-maker, else the first contact, as the card's lead person.
    const lead =
      c.contacts.find((ct) => ct.isDecisionMaker) ?? c.contacts[0] ?? null;
    const card: PipelineCard = {
      id: c.id,
      fields: {
        contact: lead ? contactName(lead) : null,
        company: companyName(c),
        ville: c.ville,
      },
      priorite: c.priorite,
      potentiel: c.potentiel,
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
    (initial[c.stage as StageValue] ?? initial.A_QUALIFIER).push(card);
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
      />
    </div>
  );
}

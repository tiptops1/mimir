import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, Badge, Button, Input, EmptyState } from "@/components/ui";
import { retrieve, type Passage } from "@/lib/rag/retrieve";

// S13 — RAG demo surface. Read-only: no ledger, no AgentEvent, nothing to
// approve. A plain GET form (not a debounced client fetch, cf. GlobalSearch)
// because retrieve() calls the Gemini embedding API on every query — firing
// that per keystroke would burn AI budget for no benefit on a demo page.

export default async function MimisbrunnrPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";

  let passages: Passage[] = [];
  let failed = false;
  if (q) {
    try {
      passages = await retrieve(prisma, q);
    } catch {
      failed = true;
    }
  }

  const titles = new Map<string, string>();
  if (passages.length > 0) {
    const docs = await prisma.knowledgeDocument.findMany({
      where: { id: { in: [...new Set(passages.map((p) => p.docId))] } },
      select: { id: true, title: true },
    });
    for (const d of docs) titles.set(d.id, d.title);
  }

  return (
    <div>
      <PageHeader
        title="Mímisbrunnr"
        subtitle="Interrogez la base de connaissances"
      />
      <div className="p-6">
        <form className="mb-6 flex max-w-xl gap-2">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Posez une question…"
            className="flex-1"
          />
          <Button type="submit">Rechercher</Button>
        </form>

        {!q ? (
          <EmptyState
            title="Posez une question pour interroger la base"
            hint="Les passages cités proviendront des documents ingérés (Mímisbrunnr)."
          />
        ) : failed ? (
          <EmptyState
            title="Recherche indisponible"
            hint="L'index vectoriel n'est peut-être pas encore prêt. Réessayez dans quelques instants."
          />
        ) : passages.length === 0 ? (
          <EmptyState
            title="Aucun passage trouvé"
            hint="Reformulez votre question ou vérifiez qu'un document a été ingéré."
          />
        ) : (
          <div className="space-y-3">
            {passages.map((p) => (
              <Card key={p.chunkId}>
                <CardBody>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {titles.get(p.docId) ?? "Document"}
                    </p>
                    <Badge tone="info">{p.score.toFixed(2)}</Badge>
                  </div>
                  <p className="whitespace-pre-line text-sm text-muted">{p.text}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

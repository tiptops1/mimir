import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { FinanceEntryForm } from "@/components/finance-entry-form";
import { serializeFinanceRow } from "@/lib/finance-cockpit";
import { DEFAULT_FINANCE_CATEGORIES, KIND_META } from "@/lib/finance";
import { companyName } from "@/lib/display";

export default async function FinanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const { id } = await params;

  const [entry, catDef, companiesRaw] = await Promise.all([
    prisma.financeEntry.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, nomSociete: true, enseigne: true, siret: true },
        },
      },
    }),
    prisma.fieldDefinition.findFirst({
      where: { entity: "FINANCE", key: "category" },
      select: { options: true },
    }),
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
      orderBy: { nomSociete: "asc" },
    }),
  ]);

  if (!entry) notFound();

  const row = serializeFinanceRow(entry);
  const categories =
    catDef?.options && catDef.options.length > 0
      ? catDef.options
      : DEFAULT_FINANCE_CATEGORIES;
  const companies = companiesRaw.map((c) => ({ id: c.id, name: companyName(c) }));

  return (
    <div>
      <PageHeader
        title={row.label}
        subtitle={KIND_META[row.kind]?.label ?? row.kind}
      >
        <LinkButton href="/finances" variant="secondary">
          ← Finances
        </LinkButton>
      </PageHeader>

      <div className="max-w-3xl space-y-6 p-6">
        <FinanceEntryForm
          entry={row}
          mode="edit"
          categories={categories}
          companies={companies}
        />
      </div>
    </div>
  );
}

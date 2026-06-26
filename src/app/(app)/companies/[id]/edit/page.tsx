import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "@/components/company-form";
import { companyName } from "@/lib/display";
import { getStageDefs } from "@/lib/stage-config";
import { getFieldDefs } from "@/lib/field-config";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();
  const stages = await getStageDefs();
  const nativeDefs = (await getFieldDefs("COMPANY")).filter((d) => d.source === "NATIVE");

  return (
    <div>
      <PageHeader
        title={`Modifier — ${companyName(company)}`}
        subtitle={company.siret}
      />
      <div className="mx-auto max-w-4xl p-6">
        <CompanyForm mode="edit" company={company} stages={stages} nativeDefs={nativeDefs} />
      </div>
    </div>
  );
}

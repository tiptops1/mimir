import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "@/components/company-form";
import { companyName } from "@/lib/display";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();

  return (
    <div>
      <PageHeader
        title={`Modifier — ${companyName(company)}`}
        subtitle={company.siret}
      />
      <div className="mx-auto max-w-4xl p-6">
        <CompanyForm mode="edit" company={company} />
      </div>
    </div>
  );
}

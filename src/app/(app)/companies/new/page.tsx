import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "@/components/company-form";
import { getStageDefs } from "@/lib/stage-config";
import { getFieldDefs } from "@/lib/field-config";

export default async function NewCompanyPage() {
  await verifySession();
  const stages = await getStageDefs();
  const nativeDefs = (await getFieldDefs("COMPANY")).filter((d) => d.source === "NATIVE");
  return (
    <div>
      <PageHeader
        title="Nouvelle société"
        subtitle="Ajouter un prospect au CRM"
      />
      <div className="mx-auto max-w-4xl p-6">
        <CompanyForm mode="create" stages={stages} nativeDefs={nativeDefs} />
      </div>
    </div>
  );
}

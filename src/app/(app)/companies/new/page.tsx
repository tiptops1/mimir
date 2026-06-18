import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "@/components/company-form";

export default async function NewCompanyPage() {
  await verifySession();
  return (
    <div>
      <PageHeader
        title="Nouvelle société"
        subtitle="Ajouter un prospect au CRM"
      />
      <div className="mx-auto max-w-4xl p-6">
        <CompanyForm mode="create" />
      </div>
    </div>
  );
}

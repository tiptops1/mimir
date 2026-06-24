import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { companyName } from "@/lib/display";
import { NewContactForm } from "@/components/new-contact-form";

export default async function NewContactPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const companies = await prisma.company.findMany({
    select: { id: true, nomSociete: true, enseigne: true, siret: true },
    orderBy: { nomSociete: "asc" },
  });

  const options = companies
    .map((c) => ({ id: c.id, name: companyName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return (
    <div>
      <PageHeader
        title="Nouveau contact"
        subtitle="Rattacher à une société existante ou en créer une nouvelle"
      />
      <div className="max-w-3xl p-6">
        <NewContactForm companies={options} />
      </div>
    </div>
  );
}

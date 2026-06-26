import { requireRole } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["ADMIN"]);

  return (
    <div>
      <PageHeader
        title="Paramètres"
        subtitle="Personnalisez les champs et le pipeline de votre CRM"
      />
      <div className="border-b border-border bg-card px-6">
        <SettingsTabs />
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

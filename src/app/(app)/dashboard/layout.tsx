import { requireModule } from "@/lib/tenant-profile";

/**
 * The dashboard is the CRM's home, not a neutral one: it reads companies,
 * contacts, the stage funnel and the finance cockpit, and its observatory hero
 * renders the four CRM realms. A tenant without the CRM is sent to its own home
 * (see homePathFor in src/lib/modules.ts).
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModule("crm");
  return <>{children}</>;
}

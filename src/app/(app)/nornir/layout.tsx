import { requireModule } from "@/lib/tenant-profile";

/**
 * Module guard. Hiding the sidebar entry is not access control — this route
 * stays reachable by URL — so the CRM surface is gated here. Covers every
 * nested route in this folder. See src/lib/modules.ts.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModule("crm");
  return <>{children}</>;
}

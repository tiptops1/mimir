import { requireModule } from "@/lib/tenant-profile";

/**
 * Module guard for the Chronos vertical. Hiding the sidebar entry is not access
 * control — this route stays reachable by URL. Covers every nested route in
 * this folder. See src/lib/modules.ts.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModule("chronos");
  return <>{children}</>;
}

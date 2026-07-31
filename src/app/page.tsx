import { redirect } from "next/navigation";

export default function Home() {
  // The inventory is home. Kept in sync with homePathFor (src/lib/modules.ts) —
  // this runs before any session, so it can't read the tenant's own modules.
  redirect("/chronos");
}

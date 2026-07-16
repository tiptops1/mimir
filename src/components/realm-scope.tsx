"use client";

import { usePathname } from "next/navigation";
import { realmForPath } from "@/lib/realms";

/**
 * Stamps the current realm on the app shell so the realm tokens in
 * globals.css ([data-realm="…"]) cascade to everything inside — sidebar
 * active state, focus rings, selection. Routes outside any realm (settings,
 * auth) render no attribute and fall back to the neutral brand accent.
 *
 * `display: contents` keeps the wrapper out of the flex layout; rendering the
 * attribute here (not via effect on <html>) keeps server and client HTML
 * identical, so there's no accent flash on first paint.
 */
export function RealmScope({ children }: { children: React.ReactNode }) {
  const realm = realmForPath(usePathname());
  return (
    <div data-realm={realm} className="contents">
      {children}
    </div>
  );
}

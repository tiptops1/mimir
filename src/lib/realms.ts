/**
 * Realm map — the cosmos config (see .claude/skills/mimir-cosmos).
 * A realm is a group of modules sharing one accent identity; hue values live
 * in globals.css keyed by the slug, components only ever read realm tokens
 * (bg-realm, text-realm, …). Modules join the cosmos by adding a route here.
 */
export type RealmSlug = "relation" | "chasse" | "tresor" | "mimir";

export type Realm = {
  slug: RealmSlug;
  /** Sidebar group heading. */
  label: string;
  /** First path segments owned by the realm. */
  routes: string[];
};

export const REALMS: Realm[] = [
  {
    slug: "relation",
    label: "Relation",
    routes: ["dashboard", "todo", "companies", "contacts", "pipeline"],
  },
  {
    slug: "chasse",
    label: "Chasse",
    routes: ["leadone", "outreach", "inbox"],
  },
  {
    slug: "tresor",
    label: "Trésor",
    routes: ["finances", "analytics"],
  },
  {
    slug: "mimir",
    label: "Mimir",
    // Agent modules land here from S7 on (heimdallr first).
    routes: ["heimdallr"],
  },
];

export function realmForPath(pathname: string): RealmSlug | undefined {
  const seg = pathname.split("/")[1];
  return REALMS.find((r) => r.routes.includes(seg))?.slug;
}

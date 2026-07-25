/**
 * Realm map — the cosmos config (see .claude/skills/mimir-cosmos).
 * A realm is a group of modules sharing one accent identity; hue values live
 * in globals.css keyed by the slug, components only ever read realm tokens
 * (bg-realm, text-realm, …). Modules join the cosmos by adding a route here.
 * Dark-theme hues trace back to the abyss/bone/brass/well/ember/live palette
 * in docs/mimir-architecture.html (see C1, docs/mimir/roadmap.md).
 */
export type RealmSlug =
  | "relation"
  | "chasse"
  | "tresor"
  | "mimir"
  | "chronos";

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
    // Labelled by function, not by product: this heading renders in every
    // tenant's sidebar, and the product name is now per-tenant (Tenant.brandName),
    // so "Mimir" here leaked the platform's name into a rebranded shell.
    // The realm SLUG stays "mimir" — it keys the hue and the route map.
    label: "Agents",
    // Agent modules land here from S7 on (heimdallr first, mimisbrunnr S13,
    // nornir S17, forseti S19, thor S22a, freyja S25). Huginn/Muninn/Bragi
    // have no standalone route — their drafts surface through the Heimdallr inbox.
    routes: ["heimdallr", "mimisbrunnr", "nornir", "forseti", "thor", "freyja"],
  },
  {
    slug: "chronos",
    label: "Chronos",
    // The buy/restore/resell inventory vertical (S27+). Its agent modules
    // (Argus, Kairos, Hephaestus, Hermes, Plutus) share this one hue rather
    // than each earning a realm — same posture as the Mimir agent realm above.
    routes: ["chronos"],
  },
];

export function realmForPath(pathname: string): RealmSlug | undefined {
  const seg = pathname.split("/")[1];
  return REALMS.find((r) => r.routes.includes(seg))?.slug;
}

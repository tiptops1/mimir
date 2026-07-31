/**
 * Realm map — the cosmos config. A realm is a group of modules sharing one
 * accent identity; hue values live in globals.css keyed by the slug, components
 * only ever read realm tokens (bg-realm, text-realm, …). Modules join the
 * cosmos by adding a route here.
 *
 * The four realms and their hues are specified in docs/chronos/BRAND.md §3,
 * all four drawn out of the emblem: the nebula, the orbit rings, the sapphire
 * crown, the comet hand.
 */
export type RealmSlug = "atelier" | "marche" | "tresor" | "agents";

export type Realm = {
  slug: RealmSlug;
  /** Sidebar group heading. */
  label: string;
  /** First path segments owned by the realm. */
  routes: string[];
};

export const REALMS: Realm[] = [
  {
    slug: "atelier",
    label: "Atelier",
    // The inventory heartland: the unit list, unit detail, cost ledger.
    // `chronos` is one route segment covering several pages, so the finance
    // and market surfaces below are nested under it and claimed by path in
    // realmForPath — the only place a realm is keyed on more than segment 1.
    routes: ["chronos"],
  },
  {
    slug: "marche",
    label: "Marché",
    routes: ["chronos/import", "chronos/reconciliation", "chronos/argus"],
  },
  {
    slug: "tresor",
    label: "Trésor",
    routes: ["chronos/finance"],
  },
  {
    slug: "agents",
    // Labelled by function, never by the module's internal codename: this
    // heading renders in every tenant's shell.
    label: "Agents",
    routes: ["heimdallr"],
  },
];

/**
 * Realm owning a path.
 *
 * Two-segment routes are matched first and win, so /chronos/finance resolves to
 * `tresor` rather than being swallowed by the `chronos` segment that `atelier`
 * owns. Anything unmatched (settings, auth) gets no realm and falls back to the
 * neutral brand accent.
 */
export function realmForPath(pathname: string): RealmSlug | undefined {
  const parts = pathname.split("/").filter(Boolean);
  const two = parts.slice(0, 2).join("/");
  const one = parts[0] ?? "";
  return (
    REALMS.find((r) => r.routes.includes(two))?.slug ??
    REALMS.find((r) => r.routes.includes(one))?.slug
  );
}

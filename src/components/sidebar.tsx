"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wallet,
  Settings,
  LogOut,
  ShieldCheck,
  Watch,
  Scale,
  PackageOpen,
  SlidersHorizontal,
  TrendingUp,
  Crosshair,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { BrandEgg } from "@/components/brand-egg";
import { logout } from "@/app/actions/auth";
import { REALMS, realmForPath, type RealmSlug } from "@/lib/realms";
import { hasModule, type TenantModule } from "@/lib/modules";
import { cn, initialsFromName } from "@/lib/utils";

// Each entry declares the module that owns it, so a tenant only ever sees the
// verticals it bought (src/lib/modules.ts). "core" = every tenant gets it.
// NOTE: hiding an entry is not access control — the route stays reachable by
// URL, so module-scoped pages also call requireModule().
//
// Labels are trade vocabulary, never internal codenames and never generic-CRM
// vocabulary ("société", "prospect", "deal") — docs/chronos/BRAND.md §7.
const NAV: Array<{
  href: string;
  label: string;
  icon: typeof Settings;
  module: TenantModule;
}> = [
  { href: "/chronos", label: "Inventaire", icon: Watch, module: "chronos" },
  { href: "/chronos/import", label: "Ventes", icon: PackageOpen, module: "chronos" },
  { href: "/chronos/reconciliation", label: "Rapprochement", icon: Scale, module: "chronos" },
  { href: "/chronos/argus", label: "Cote du marché", icon: TrendingUp, module: "chronos" },
  { href: "/chronos/sourcing", label: "Sourcing", icon: Crosshair, module: "chronos" },
  { href: "/chronos/finance", label: "Finances", icon: Wallet, module: "chronos" },
  { href: "/chronos/settings", label: "Réglages métier", icon: SlidersHorizontal, module: "chronos" },
  { href: "/heimdallr/inbox", label: "Approbations", icon: ShieldCheck, module: "core" },
];

/**
 * Nav grouped into realms (the cosmos layer — see src/lib/realms.ts), filtered
 * to the tenant's entitlement. Realms with nothing left to show — because the
 * modules don't exist yet, or this tenant didn't buy them — render nothing.
 */
function groupsFor(modules: string[]) {
  return REALMS.map((realm) => ({
    realm,
    items: NAV.filter(
      (item) =>
        // realmForPath, not a segment lookup: realms now own two-segment routes
        // (/chronos/finance is Trésor, not Atelier), and only that function
        // knows the precedence between them.
        realmForPath(item.href) === realm.slug && hasModule(modules, item.module),
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * The nav entry a path belongs to: the LONGEST href that prefixes it.
 *
 * A plain `startsWith` would light up both "Inventaire" (/chronos) and
 * "Finances" (/chronos/finance) on the finance page, since every Chronos
 * surface is nested under the same segment. Longest-match makes the deepest
 * entry win and leaves /chronos/[id] correctly on "Inventaire".
 */
function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function NavItem({
  item,
  active,
  badge,
  realmSlug,
  currentRealm,
}: {
  item: { href: string; label: string; icon: typeof Settings };
  active: boolean;
  badge: number;
  realmSlug?: RealmSlug;
  currentRealm?: RealmSlug;
}) {
  const Icon = item.icon;
  const crossesRealm =
    realmSlug !== undefined &&
    currentRealm !== undefined &&
    realmSlug !== currentRealm;
  return (
    <Link
      href={item.href}
      transitionTypes={crossesRealm ? ["realm-shift"] : []}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-100",
        active
          ? "bg-realm-subtle text-foreground"
          : "text-muted hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-realm" />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-realm" : "text-faint group-hover:text-muted",
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {badge > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-on-brand tnum">
          {badge}
        </span>
      )}
    </Link>
  );
}

export type SidebarProps = {
  user: { name: string; email: string; role: string };
  /** The tenant's entitled modules — drives which realms/entries render. */
  modules: string[];
  /** The tenant's product name, shown in the wordmark. */
  brandName: string;
  /** The tenant's logo, replacing the default glyph tile. Null = built-in mark. */
  brandLogoUrl?: string | null;
  /** Agent proposals awaiting a human decision. The only nav badge left. */
  heimdallrPendingCount?: number;
  className?: string;
};

export function Sidebar({
  user,
  modules,
  brandName,
  brandLogoUrl = null,
  heimdallrPendingCount = 0,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const currentRealm = realmForPath(pathname);
  const groups = groupsFor(modules);
  const current = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );

  const badgeFor = (href: string) =>
    href === "/heimdallr/inbox" ? heimdallrPendingCount : 0;

  return (
    <aside
      style={{ viewTransitionName: "cosmos-sidebar" }}
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-card",
        className,
      )}
    >
      <div className="px-5 py-4">
        <BrandEgg label={brandName}>
          <BrandMark name={brandName} logoUrl={brandLogoUrl} />
        </BrandEgg>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-1">
        {groups.map(({ realm, items }) => (
          <div key={realm.slug} className="pt-4 first:pt-0">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {realm.label}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={current === item.href}
                  badge={badgeFor(item.href)}
                  realmSlug={realm.slug}
                  currentRealm={currentRealm}
                />
              ))}
            </div>
          </div>
        ))}
        {user.role === "ADMIN" && (
          <div className="mt-4 border-t border-border pt-3">
            <NavItem
              item={{ href: "/settings", label: "Paramètres", icon: Settings }}
              active={pathname === "/settings" || pathname.startsWith("/settings/")}
              badge={0}
            />
          </div>
        )}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-[11px] font-semibold text-brand">
            {initialsFromName(user.name || user.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {user.name || "Utilisateur"}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-danger-subtle hover:text-danger"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}

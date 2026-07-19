"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  Users,
  KanbanSquare,
  Radar,
  BarChart3,
  Inbox,
  Send,
  Wallet,
  Settings,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  BookOpen,
  Gauge,
  HeartPulse,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { BrandEgg } from "@/components/brand-egg";
import { logout } from "@/app/actions/auth";
import { REALMS, realmForPath, type RealmSlug } from "@/lib/realms";
import { cn, initialsFromName } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/todo", label: "À faire", icon: CheckSquare },
  { href: "/companies", label: "Suivi", icon: ClipboardList },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/leadone", label: "Lead One", icon: Radar },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/inbox", label: "Boîte de réception", icon: Inbox },
  { href: "/finances", label: "Finances", icon: Wallet },
  { href: "/analytics", label: "Analytique", icon: BarChart3 },
  { href: "/heimdallr/inbox", label: "Approbations", icon: ShieldCheck },
  { href: "/mimisbrunnr", label: "Mímisbrunnr", icon: BookOpen },
  { href: "/nornir", label: "Nornir", icon: Gauge },
  { href: "/forseti", label: "Forseti", icon: ShieldAlert },
  { href: "/thor", label: "Thor", icon: HeartPulse },
];

// Nav grouped into realms (the cosmos layer — see src/lib/realms.ts). Realms
// whose modules don't exist yet (e.g. Mimir before S7) simply render nothing.
const GROUPS = REALMS.map((realm) => ({
  realm,
  items: NAV.filter((item) => realm.routes.includes(item.href.split("/")[1])),
})).filter((g) => g.items.length > 0);

function NavItem({
  item,
  pathname,
  badge,
  realmSlug,
  currentRealm,
}: {
  item: { href: string; label: string; icon: typeof Settings };
  pathname: string;
  badge: number;
  realmSlug?: RealmSlug;
  currentRealm?: RealmSlug;
}) {
  const active =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
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
  pendingCount?: number;
  todoCount?: number;
  leadOneCount?: number;
  heimdallrPendingCount?: number;
  className?: string;
};

export function Sidebar({
  user,
  pendingCount = 0,
  todoCount = 0,
  leadOneCount = 0,
  heimdallrPendingCount = 0,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const currentRealm = realmForPath(pathname);

  const badgeFor = (href: string) =>
    href === "/inbox"
      ? pendingCount
      : href === "/todo"
        ? todoCount
        : href === "/leadone"
          ? leadOneCount
          : href === "/heimdallr/inbox"
            ? heimdallrPendingCount
            : 0;

  return (
    <aside
      style={{ viewTransitionName: "cosmos-sidebar" }}
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-card",
        className,
      )}
    >
      <div className="px-5 py-4">
        <BrandEgg>
          <BrandMark />
        </BrandEgg>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-1">
        {GROUPS.map(({ realm, items }) => (
          <div key={realm.slug} className="pt-4 first:pt-0">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {realm.label}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  pathname={pathname}
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
              pathname={pathname}
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

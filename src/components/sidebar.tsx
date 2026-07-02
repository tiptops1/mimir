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
  Wallet,
  Settings,
  LogOut,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { logout } from "@/app/actions/auth";
import { cn, initialsFromName } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/todo", label: "À faire", icon: CheckSquare },
  { href: "/companies", label: "Suivi", icon: ClipboardList },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/leadone", label: "Lead One", icon: Radar },
  { href: "/inbox", label: "Boîte de réception", icon: Inbox },
  { href: "/finances", label: "Finances", icon: Wallet },
  { href: "/analytics", label: "Analytique", icon: BarChart3 },
];

export type SidebarProps = {
  user: { name: string; email: string; role: string };
  pendingCount?: number;
  todoCount?: number;
  className?: string;
};

export function Sidebar({
  user,
  pendingCount = 0,
  todoCount = 0,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const nav =
    user.role === "ADMIN"
      ? [...NAV, { href: "/settings", label: "Paramètres", icon: Settings }]
      : NAV;

  return (
    <aside
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-card",
        className,
      )}
    >
      <div className="px-5 py-4">
        <BrandMark />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 pt-1">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const badge =
            item.href === "/inbox"
              ? pendingCount
              : item.href === "/todo"
                ? todoCount
                : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-100",
                active
                  ? "bg-surface-2 text-foreground"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
              )}
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-colors",
                  active
                    ? "text-brand"
                    : "text-faint group-hover:text-muted",
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
        })}
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

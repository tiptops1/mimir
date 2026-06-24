"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  Users,
  KanbanSquare,
  BarChart3,
  Inbox,
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
  { href: "/inbox", label: "Boîte de réception", icon: Inbox },
  { href: "/analytics", label: "Analytique", icon: BarChart3 },
];

export function Sidebar({
  user,
  pendingCount = 0,
  todoCount = 0,
}: {
  user: { name: string; email: string; role: string };
  pendingCount?: number;
  todoCount?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-5 py-5">
        <BrandMark />
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
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
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-indigo-50 text-brand"
                  : "text-slate-600 hover:bg-slate-50 hover:text-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-brand">
            {initialsFromName(user.name || user.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user.name || "Utilisateur"}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}

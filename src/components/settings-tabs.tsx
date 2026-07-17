"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/fields", label: "Champs" },
  { href: "/settings/stages", label: "Étapes" },
  { href: "/settings/integrations", label: "Intégrations" },
  { href: "/settings/duplicates", label: "Doublons" },
  { href: "/settings/import", label: "Import" },
  { href: "/settings/audit", label: "Audit" },
];

// Vendor-only tab (PLATFORM_ADMIN_EMAILS) — the layout decides visibility.
const TENANTS_TAB = { href: "/settings/tenants", label: "Tenants" };

export function SettingsTabs({ showTenants = false }: { showTenants?: boolean }) {
  const pathname = usePathname();
  const tabs = showTenants ? [...TABS, TENANTS_TAB] : TABS;
  return (
    <nav className="flex gap-4 overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-1 py-3 text-sm font-medium transition-colors",
              active
                ? "border-brand text-brand"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

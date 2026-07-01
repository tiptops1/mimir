"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/fields", label: "Champs" },
  { href: "/settings/stages", label: "Étapes" },
  { href: "/settings/integrations", label: "Intégrations" },
  { href: "/settings/duplicates", label: "Doublons" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4">
      {TABS.map((tab) => {
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

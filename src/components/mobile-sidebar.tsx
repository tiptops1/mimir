"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar, type SidebarProps } from "@/components/sidebar";

/**
 * Below `lg` the static sidebar is hidden; this renders the hamburger in the
 * topbar and a slide-over drawer hosting the same <Sidebar/>.
 */
export function MobileSidebar(props: Omit<SidebarProps, "className">) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating inside the drawer closes it — adjust-during-render pattern
  // (https://react.dev/learn/you-might-not-need-an-effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Ouvrir le menu"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="animate-drawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] shadow-lg">
            <Sidebar {...props} className="w-full" />
            <button
              type="button"
              aria-label="Fermer le menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

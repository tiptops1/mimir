"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Plus, X } from "lucide-react";
import { createSavedView, deleteSavedView } from "@/app/actions/saved-views";

// Chip row of the user's saved views for a list page. Clicking a chip applies
// its stored querystring; the "Enregistrer" affordance appears whenever the
// current filters aren't already saved. Views are per-user (see SavedView).

export interface SavedViewItem {
  id: string;
  name: string;
  query: string;
}

function normalized(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("page");
  params.sort();
  return params.toString();
}

export function SavedViews({
  page,
  views,
}: {
  page: "companies" | "contacts";
  views: SavedViewItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const current = normalized(searchParams.toString());
  const activeView = views.find((v) => v.query === current);
  const canSave = current.length > 0 && !activeView;

  if (views.length === 0 && !canSave) return null;

  const apply = (v: SavedViewItem) => router.push(`${pathname}?${v.query}`);

  const save = () => {
    startTransition(async () => {
      const res = await createSavedView(page, name, current);
      if (res.error) {
        setError(res.error);
      } else {
        setError(null);
        setNaming(false);
        setName("");
        router.refresh();
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      await deleteSavedView(id);
      router.refresh();
    });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Bookmark className="h-3.5 w-3.5 text-faint" aria-hidden />
      {views.map((v) => {
        const active = v.query === current;
        return (
          <span
            key={v.id}
            className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-brand bg-brand-subtle text-brand"
                : "border-border bg-card text-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            <button type="button" onClick={() => apply(v)} disabled={pending}>
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => remove(v.id)}
              disabled={pending}
              aria-label={`Supprimer la vue ${v.name}`}
              className="rounded-full p-0.5 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {canSave &&
        (naming ? (
          <span className="inline-flex items-center gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setNaming(false);
              }}
              placeholder="Nom de la vue"
              className="h-7 w-40 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={save}
              disabled={pending || !name.trim()}
              className="rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="text-xs text-muted hover:text-foreground"
            >
              Annuler
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
          >
            <Plus className="h-3 w-3" />
            Enregistrer la vue
          </button>
        ))}

      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

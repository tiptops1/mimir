"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";

// Saved views (P2.2): a named URL querystring per user per list page. Applying
// a view is plain navigation, so the filters themselves stay URL-driven
// (useUrlFilters) and nothing here duplicates the filter schema.

export interface SavedViewResult {
  error?: string;
  ok?: boolean;
}

const PAGES: Record<string, string> = {
  companies: "/companies",
  contacts: "/contacts",
};

const MAX_VIEWS_PER_PAGE = 20;

/** Normalize a raw querystring: parse, drop pagination, re-serialize sorted. */
function normalizeQuery(raw: string): string {
  const params = new URLSearchParams(raw);
  params.delete("page");
  params.sort();
  return params.toString();
}

export async function createSavedView(
  page: string,
  name: string,
  query: string,
): Promise<SavedViewResult> {
  const session = await verifySession();
  const path = PAGES[page];
  if (!path) return { error: "Page inconnue." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Donnez un nom à la vue." };
  if (trimmed.length > 60) return { error: "Nom trop long (60 caractères max)." };
  const normalized = normalizeQuery(query.slice(0, 2000));
  if (!normalized) return { error: "Aucun filtre actif à enregistrer." };

  const prisma = await getTenantDb();
  const count = await prisma.savedView.count({
    where: { userId: session.userId, page },
  });
  if (count >= MAX_VIEWS_PER_PAGE) {
    return { error: `Maximum ${MAX_VIEWS_PER_PAGE} vues par page — supprimez-en une d'abord.` };
  }

  await prisma.savedView.create({
    data: { userId: session.userId, page, name: trimmed, query: normalized },
  });
  revalidatePath(path);
  return { ok: true };
}

export async function deleteSavedView(id: string): Promise<SavedViewResult> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  // Scoped delete: only the owner's own view can match.
  await prisma.savedView.deleteMany({
    where: { id, userId: session.userId },
  });
  revalidatePath("/companies");
  revalidatePath("/contacts");
  return { ok: true };
}

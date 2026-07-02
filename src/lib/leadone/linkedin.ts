import type { PrismaClient } from "@prisma/client";
import { takeQuota } from "./quota";

// LinkedIn has no free API, so we only ever get a real profile URL via a
// quota-gated search (SerpApi free tier, 100/month, spent only on already
// VALIDATED candidates). When that budget is exhausted or the person can't be
// confidently matched, the UI falls back to a plain search-results link —
// never a guess passed off as a verified profile.

export function buildLinkedinSearchUrl(name: string, company: string): string {
  const terms = [name, company].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export type LinkedinLookup =
  | { status: "found"; url: string }
  | { status: "not_found" }
  // No key configured, or the serpapi budget is spent — distinct from
  // "not_found" so callers don't mark the dirigeant as checked and lose the
  // chance to verify once the monthly quota resets.
  | { status: "unavailable" };

export async function verifyLinkedinProfile(
  prisma: PrismaClient,
  name: string,
  company: string,
): Promise<LinkedinLookup> {
  const key = process.env.SERPAPI_KEY;
  if (!key || !name.trim()) return { status: "unavailable" };
  if (!(await takeQuota(prisma, "serpapi"))) return { status: "unavailable" };

  try {
    const q = `site:linkedin.com/in "${name}" "${company}"`;
    const url =
      `https://serpapi.com/search.json?engine=google&num=5` +
      `&q=${encodeURIComponent(q)}&api_key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { status: "not_found" };
    const data = (await res.json()) as {
      organic_results?: { link?: string; title?: string }[];
    };
    const surname = lastName(name);
    for (const r of data.organic_results ?? []) {
      if (!r.link || !/linkedin\.com\/in\//.test(r.link)) continue;
      // Precision guard: the result must actually reference this person —
      // a site: filter narrows the source but not the match.
      const haystack = `${r.link} ${r.title ?? ""}`.toLowerCase();
      if (surname && haystack.includes(surname)) return { status: "found", url: r.link };
    }
    return { status: "not_found" };
  } catch {
    return { status: "not_found" };
  }
}

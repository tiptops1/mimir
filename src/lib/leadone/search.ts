import type { PrismaClient } from "@prisma/client";
import { discoverWebsiteFree, hostsFromUrls, hostMatchesName } from "../enrich";
import { takeQuota } from "./quota";

// Quota-gated website discovery for Lead One. Exactly ONE search-engine query
// is spent per attempt (API-capacity conservation): the first provider with
// available budget runs, and a "no confident match" result does NOT fall
// through to the next provider — later attempts (other days) vary the query
// instead. Only API providers here: keyless Bing/DDG get blocked from
// datacenter IPs (GH Actions), so they stay in enrich.ts for local runs.

async function tavilySearch(query: string): Promise<string[] | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      // search_depth "basic" = 1 credit; "advanced" would cost 2 for no gain
      // here — we only need candidate URLs, not extracted content.
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        country: "france",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { url?: string }[] };
    return (data.results ?? [])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));
  } catch {
    return null;
  }
}

async function exaSearch(query: string): Promise<string[] | null> {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ query, num_results: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { url?: string }[] };
    return (data.results ?? [])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));
  } catch {
    return null;
  }
}

export interface DiscoverOutcome {
  site: string | null;
  provider: "tavily" | "exa" | "keyless" | null;
  // Distinguishes "budget spent, resume next window" from "nothing configured".
  quotaExhausted: boolean;
  noProvider: boolean;
}

// Query variants across retry attempts — same query twice would just burn
// budget on an identical result set.
function buildQuery(name: string, attempt: number): string {
  if (attempt <= 0) return `${name} courtier assurance`;
  if (attempt === 1) return `${name} assurance`;
  return `"${name}"`;
}

export async function discoverWebsiteQuotaed(
  prisma: PrismaClient,
  name: string,
  attempt = 0,
): Promise<DiscoverOutcome> {
  if (!name.trim())
    return { site: null, provider: null, quotaExhausted: false, noProvider: false };
  const query = buildQuery(name, attempt);

  // Provider preference: Tavily first (its 1000/month is dedicated to this
  // stage), then Exa as overflow. Both quotas are monthly since Google CSE
  // (the old daily primary) was shut down.
  const providers: Array<{
    id: "tavily" | "exa";
    run: (q: string) => Promise<string[] | null>;
    configured: boolean;
  }> = [
    {
      id: "tavily",
      run: tavilySearch,
      configured: Boolean(process.env.TAVILY_API_KEY),
    },
    {
      id: "exa",
      run: exaSearch,
      configured: Boolean(process.env.EXA_API_KEY),
    },
  ];

  let anyConfigured = false;
  for (const p of providers) {
    if (!p.configured) continue;
    anyConfigured = true;
    if (!(await takeQuota(prisma, p.id))) continue; // budget gone → try next provider
    const urls = (await p.run(query)) ?? [];
    const seen = new Set<string>();
    for (const host of hostsFromUrls(urls)) {
      if (seen.has(host)) continue;
      seen.add(host);
      if (hostMatchesName(host, name)) {
        return {
          site: `https://${host}`,
          provider: p.id,
          quotaExhausted: false,
          noProvider: false,
        };
      }
    }
    // One query spent, no confident match — stop here on purpose.
    return { site: null, provider: p.id, quotaExhausted: false, noProvider: false };
  }

  // Keyless fallback (Bing HTML + DDG Lite via discoverWebsiteFree): free and
  // unlimited but blocked from datacenter IPs — local residential runs only,
  // opt-in with LEADONE_KEYLESS=1. Never used on GitHub Actions.
  if (process.env.LEADONE_KEYLESS === "1") {
    const site = await discoverWebsiteFree(name, null);
    return { site, provider: "keyless", quotaExhausted: false, noProvider: false };
  }

  return {
    site: null,
    provider: null,
    quotaExhausted: anyConfigured,
    noProvider: !anyConfigured,
  };
}

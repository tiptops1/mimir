import type { PrismaClient } from "@prisma/client";

// The "brain": turns raw interaction text (an email, a meeting, a call
// transcript) into structured CRM signal via an LLM. Decoupled from any one
// source so email / calendar / Fireflies all share it.
//
// Provider selection (first key wins):
//   1. GEMINI_API_KEY   -> Google Gemini, free tier (OpenAI-compatible endpoint)
//   2. ANTHROPIC_API_KEY -> Claude (Haiku) — usage-based, a few €/month here
// With neither key set it is a no-op, so the rest of the pipeline keeps logging
// activities — they just won't carry AI insight.

// --- Gemini (free tier) — preferred. OpenAI-compatible chat endpoint. ---
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// 2.5 Flash has a generous free tier and good French. Override with GEMINI_MODEL.
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

// --- Claude (Anthropic) — fallback. ---
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Haiku is cheap + fast and plenty for extraction. Override with ANTHROPIC_MODEL.
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Must match the PipelineStage enum in schema.prisma.
const STAGES = [
  "A_QUALIFIER",
  "A_CONTACTER",
  "CONTACTE",
  "RDV_OBTENU",
  "DEMO_REALISEE",
  "PROPOSITION_ENVOYEE",
  "GAGNE",
  "PERDU",
] as const;

export interface CrmInsight {
  summary: string; // 1–2 sentence neutral recap, in French
  sentiment: "POSITIF" | "NEUTRE" | "NEGATIF" | null;
  interestLevel: "FORT" | "MOYEN" | "FAIBLE" | null;
  nextStep: string | null; // recommended next action, in French
  actionItems: string[]; // concrete to-dos extracted from the exchange
  suggestedStage: (typeof STAGES)[number] | null;
}

export interface ExtractInput {
  kind: "EMAIL" | "MEETING" | "CALL";
  subject?: string | null;
  body: string;
  companyName?: string | null;
  participants?: string[]; // names / emails present in the exchange
  direction?: string | null; // INBOUND | OUTBOUND (emails)
}

type Provider = "gemini" | "anthropic";

/** First configured provider wins; Gemini's free tier is preferred. */
function provider(): Provider | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function aiEnabled(): boolean {
  return provider() !== null;
}

const SYSTEM = `Tu es l'assistant CRM d'un courtier en assurances B2B (Avelior).
On te donne le contenu d'un email, d'une réunion ou d'un compte-rendu d'appel
avec un prospect. Tu en extrais le signal commercial utile au suivi.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{
  "summary": "résumé neutre en 1-2 phrases (français)",
  "sentiment": "POSITIF" | "NEUTRE" | "NEGATIF",
  "interestLevel": "FORT" | "MOYEN" | "FAIBLE",
  "nextStep": "prochaine action recommandée (français)" | null,
  "actionItems": ["tâche concrète", ...],
  "suggestedStage": un de [A_QUALIFIER, A_CONTACTER, CONTACTE, RDV_OBTENU, DEMO_REALISEE, PROPOSITION_ENVOYEE, GAGNE, PERDU] | null
}

Règles : sois factuel, n'invente rien. Si l'information manque, mets null (ou []
pour actionItems). "suggestedStage" reflète l'avancement visible dans l'échange,
pas une supposition.`;

/** Pull the first balanced JSON object out of a model response. */
function parseJsonObject(text: string): unknown {
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function coerceInsight(raw: unknown): CrmInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    typeof v === "string" && (allowed as readonly string[]).includes(v)
      ? (v as T)
      : null;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;
  return {
    summary,
    sentiment: oneOf(o.sentiment, ["POSITIF", "NEUTRE", "NEGATIF"] as const),
    interestLevel: oneOf(o.interestLevel, ["FORT", "MOYEN", "FAIBLE"] as const),
    nextStep:
      typeof o.nextStep === "string" && o.nextStep.trim()
        ? o.nextStep.trim()
        : null,
    actionItems: Array.isArray(o.actionItems)
      ? o.actionItems
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 10)
      : [],
    suggestedStage: oneOf(o.suggestedStage, STAGES),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Gemini's OpenAI-compatible chat endpoint. Returns the raw text, or null
 * on any error. Retries once on a 429 (free-tier rate limit) honouring
 * Retry-After (capped) — a persistent 429/quota leaves aiSummary null so the
 * next cron run retries the activity.
 */
async function callGemini(userContent: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        response_format: { type: "json_object" },
        // Gemini 2.5 Flash is a "thinking" model; its hidden thinking tokens bill
        // at the output rate. Extraction needs no reasoning — disabling it cut
        // billable output ~4x in testing with identical results.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number.parseInt(res.headers.get("retry-after") || "", 10);
      const waitMs = Math.min(
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000,
        10000,
      );
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      console.warn(`[ai] Gemini API ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  }
  return null;
}

/** Call Claude's Messages endpoint. Returns the raw text, or null on error. */
async function callClaude(userContent: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    console.warn(`[ai] Claude API ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return (data.content ?? [])
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("");
}

/** Call the active LLM on one interaction. Returns null if disabled or on any error. */
export async function extractInsight(
  input: ExtractInput,
): Promise<CrmInsight | null> {
  const which = provider();
  if (!which) return null;

  const body = input.body.replace(/\s+\n/g, "\n").trim().slice(0, 8000);
  if (!body) return null;

  const header = [
    `Type: ${input.kind}`,
    input.direction ? `Sens: ${input.direction}` : null,
    input.companyName ? `Société: ${input.companyName}` : null,
    input.participants?.length
      ? `Participants: ${input.participants.join(", ")}`
      : null,
    input.subject ? `Sujet: ${input.subject}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = `${header}\n\n---\n${body}`;

  try {
    const text =
      which === "gemini"
        ? await callGemini(userContent)
        : await callClaude(userContent);
    if (!text) return null;
    return coerceInsight(parseJsonObject(text));
  } catch (e) {
    console.warn(`[ai] extract failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Second pass over freshly-logged activities: fill AI insight on EMAIL/MEETING/
 * CALL records that have raw text but no summary yet. Source syncs only log raw
 * content; this keeps the model calls in one bounded, retry-safe place.
 */
export async function enrichActivities(
  prisma: PrismaClient,
  opts: { limit?: number } = {},
): Promise<{ enriched: number; skipped: number }> {
  if (!aiEnabled()) return { enriched: 0, skipped: 0 };
  const limit = opts.limit ?? 40;

  const pending = await prisma.activity.findMany({
    where: {
      type: { in: ["EMAIL", "MEETING", "CALL"] },
      aiSummary: null,
      OR: [{ body: { not: null } }, { note: { not: null } }],
    },
    orderBy: { date: "desc" },
    take: limit,
    include: { company: { select: { nomSociete: true, enseigne: true } } },
  });

  let enriched = 0;
  let skipped = 0;
  for (const a of pending) {
    const text = (a.body || a.note || "").trim();
    if (text.length < 20) {
      // Too thin to be worth a model call — mark done so we don't retry forever.
      await prisma.activity.update({
        where: { id: a.id },
        data: { aiSummary: a.subject || a.note || "(sans contenu)" },
      });
      skipped++;
      continue;
    }
    const insight = await extractInsight({
      kind: a.type as ExtractInput["kind"],
      subject: a.subject,
      body: text,
      direction: a.direction,
      companyName: a.company?.nomSociete || a.company?.enseigne || null,
    });
    if (!insight) {
      skipped++;
      continue;
    }
    await prisma.activity.update({
      where: { id: a.id },
      data: {
        aiSummary: insight.summary,
        sentiment: insight.sentiment,
        nextStep: insight.nextStep,
        suggestedStage: insight.suggestedStage,
        actionItems: insight.actionItems.length
          ? JSON.stringify(insight.actionItems)
          : null,
      },
    });

    // Surface the AI's recommended next action as a real follow-up task so it
    // lands in the "À faire" worklist instead of staying buried in the timeline.
    // Deduped by activityId so re-running this pass never creates a duplicate.
    if (insight.nextStep && a.companyId) {
      const already = await prisma.task.findFirst({
        where: { activityId: a.id },
        select: { id: true },
      });
      if (!already) {
        await prisma.task.create({
          data: {
            title: insight.nextStep,
            type: "RELANCE",
            source: "AI_NEXTSTEP",
            activityId: a.id,
            companyId: a.companyId,
            // Undated on purpose — we don't invent a deadline; it shows under
            // "À planifier" for the user to schedule.
          },
        });
      }
    }
    enriched++;
  }
  return { enriched, skipped };
}

import type { PrismaClient } from "@prisma/client";
import { loadStageDefs } from "./stage-config";
import { callByTaskClass, GEMINI_DEFAULT_MODEL, HAIKU_MODEL, type TaskClass } from "./ai/router";

// The "brain": turns raw interaction text (an email, a meeting, a call
// transcript) into structured CRM signal via an LLM. Decoupled from any one
// source so email / calendar / Fireflies all share it.
//
// Provider selection (first key wins):
//   1. GEMINI_API_KEY   -> Google Gemini, free tier (OpenAI-compatible endpoint)
//   2. ANTHROPIC_API_KEY -> Claude (Haiku) — usage-based, a few €/month here
// With neither key set it is a no-op, so the rest of the pipeline keeps logging
// activities — they just won't carry AI insight.
//
// The actual HTTP calls, metering and budget gate live in lib/ai/router.ts +
// lib/ai/meter.ts (S5) — this module only decides *which* provider/model to
// pass down, keeping the Gemini-preferred/Claude-fallback selection exactly
// as it was before the router existed.

// Override with GEMINI_MODEL / ANTHROPIC_MODEL.
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
const ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || HAIKU_MODEL;

export interface CrmInsight {
  summary: string; // 1–2 sentence neutral recap, in French
  sentiment: "POSITIF" | "NEUTRE" | "NEGATIF" | null;
  interestLevel: "FORT" | "MOYEN" | "FAIBLE" | null;
  nextStep: string | null; // recommended next action, in French
  actionItems: string[]; // concrete to-dos extracted from the exchange
  suggestedStage: string | null; // one of the tenant's configured stage keys
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

// Stages are config data (StageDefinition), so the prompt is built per-call
// from the tenant's actual stage keys instead of a hardcoded list.
function buildSystemPrompt(stageKeys: string[]): string {
  return `Tu es l'assistant CRM d'un courtier en assurances B2B (Avelior).
On te donne le contenu d'un email, d'une réunion ou d'un compte-rendu d'appel
avec un prospect. Tu en extrais le signal commercial utile au suivi.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{
  "summary": "résumé neutre en 1-2 phrases (français)",
  "sentiment": "POSITIF" | "NEUTRE" | "NEGATIF",
  "interestLevel": "FORT" | "MOYEN" | "FAIBLE",
  "nextStep": "prochaine action recommandée (français)" | null,
  "actionItems": ["tâche concrète", ...],
  "suggestedStage": un de [${stageKeys.join(", ")}] | null
}

Règles : sois factuel, n'invente rien. Si l'information manque, mets null (ou []
pour actionItems). "suggestedStage" = la dernière étape réellement FRANCHIE dans
cet échange, jamais une étape seulement prévue, promise ou planifiée. Exemples :
un rendez-vous qui vient d'avoir lieu = RDV_OBTENU ; une démo seulement planifiée
n'est PAS DEMO_REALISEE (laisse RDV_OBTENU) ; une proposition évoquée mais pas
encore envoyée n'est PAS PROPOSITION_ENVOYEE. Dans le doute, choisis l'étape la
moins avancée.`;
}

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

function coerceInsight(raw: unknown, stageKeys: string[]): CrmInsight | null {
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
    suggestedStage: oneOf(o.suggestedStage, stageKeys),
  };
}

/**
 * Generic single-shot call to the active LLM (Gemini preferred, Claude fallback).
 * Returns the raw text response, or null if no provider is configured / on error.
 * Shared by the insight-extraction pass and the email composer (lib/email-research).
 * Routes through lib/ai/router.ts (metering + budget gate, S5) with an explicit
 * provider/model override so this module's own Gemini-preferred/Claude-fallback
 * selection stays exactly as it was before the router existed.
 */
export async function callModel(
  prisma: PrismaClient,
  taskClass: TaskClass,
  system: string,
  user: string,
  opts: { maxTokens?: number } = {},
): Promise<string | null> {
  const which = provider();
  if (!which) return null;
  return callByTaskClass(prisma, taskClass, system, user, {
    maxTokens: opts.maxTokens,
    provider: which,
    model: which === "gemini" ? GEMINI_MODEL() : ANTHROPIC_MODEL(),
  });
}

/** Call the active LLM on one interaction. Returns null if disabled or on any error. */
export async function extractInsight(
  prisma: PrismaClient,
  input: ExtractInput,
  stageKeys: string[],
): Promise<CrmInsight | null> {
  if (!aiEnabled()) return null;

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

  const text = await callModel(prisma, "extract", buildSystemPrompt(stageKeys), userContent);
  if (!text) return null;
  return coerceInsight(parseJsonObject(text), stageKeys);
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
  const stageKeys = (await loadStageDefs(prisma)).map((s) => s.value);

  const pending = await prisma.activity.findMany({
    where: {
      type: { in: ["EMAIL", "MEETING", "CALL"] },
      // MongoDB stores no `aiSummary` field until we write one, and on MongoDB
      // Prisma's `aiSummary: null` does NOT match a *missing* field — so the old
      // `null` filter silently matched nothing and the AI pass never ran in prod.
      // `isSet: false` matches the un-enriched (field-absent) activities.
      aiSummary: { isSet: false },
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
    const insight = await extractInsight(
      prisma,
      {
        kind: a.type as ExtractInput["kind"],
        subject: a.subject,
        body: text,
        direction: a.direction,
        companyName: a.company?.nomSociete || a.company?.enseigne || null,
      },
      stageKeys,
    );
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

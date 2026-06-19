import type { PrismaClient } from "@prisma/client";

// The "brain": turns raw interaction text (an email, a meeting, a call
// transcript) into structured CRM signal via the Claude API. Decoupled from any
// one source so email / calendar / Fireflies all share it.
//
// Degrades gracefully: with no ANTHROPIC_API_KEY it is a no-op, so the rest of
// the pipeline keeps logging activities — they just won't carry AI insight.

const API_URL = "https://api.anthropic.com/v1/messages";
// Haiku is cheap + fast and plenty for extraction. Override with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

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

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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

/** Call Claude on one interaction. Returns null if disabled or on any error. */
export async function extractInsight(
  input: ExtractInput,
): Promise<CrmInsight | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

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

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          { role: "user", content: `${header}\n\n---\n${body}` },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`[ai] Claude API ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .map((b) => (b.type === "text" ? b.text ?? "" : ""))
      .join("");
    return coerceInsight(parseJsonObject(text));
  } catch (e) {
    console.warn(`[ai] extract failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Second pass over freshly-logged activities: fill AI insight on EMAIL/MEETING/
 * CALL records that have raw text but no summary yet. Source syncs only log raw
 * content; this keeps the Claude calls in one bounded, retry-safe place.
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
    enriched++;
  }
  return { enriched, skipped };
}

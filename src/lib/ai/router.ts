import type { PrismaClient } from "@prisma/client";
import * as meter from "./meter";
import type { Provider } from "./meter";

// Task-class -> model router (S5). PromptTemplate.taskClass ("classify |
// extract | draft | summarize", prisma/tenant/schema.prisma) declares a task
// class, never a model name — this file owns class -> model. Every call goes
// through callByTaskClass so metering (lib/ai/meter.ts) can't be bypassed.

export type TaskClass = "classify" | "extract" | "draft" | "summarize";

// --- Gemini (free tier) — OpenAI-compatible chat endpoint. ---
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

// --- Claude (Anthropic). ---
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-5";

/**
 * Default class -> {provider, model} for modules that don't exist yet
 * (Huginn/Muninn/Bragi, S14+) and drive model choice purely from taskClass.
 * `extract`'s CRM-enrichment path (ai-extract.ts) is a deliberate exception:
 * it keeps its own Gemini-preferred/Claude-fallback selection and passes an
 * explicit provider/model override to callByTaskClass instead of using this
 * table — that selection logic predates the router and must stay unchanged.
 */
export const TASK_CLASS_MODEL: Record<TaskClass, { provider: Provider; model: string }> = {
  classify: { provider: "anthropic", model: HAIKU_MODEL },
  extract: { provider: "gemini", model: GEMINI_DEFAULT_MODEL },
  draft: { provider: "anthropic", model: SONNET_MODEL },
  summarize: { provider: "anthropic", model: SONNET_MODEL },
};

interface ModelReply {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Gemini's OpenAI-compatible chat endpoint. Retries once on a 429
 * (free-tier rate limit) honouring Retry-After (capped). Returns null on any
 * other error so callers can leave the field unset and retry next run.
 */
async function callGemini(
  system: string,
  userContent: string,
  maxTokens: number,
  model: string,
): Promise<ModelReply | null> {
  const key = process.env.GEMINI_API_KEY!;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // Gemini 2.5 Flash is a "thinking" model; its hidden thinking tokens bill
        // at the output rate. Extraction needs no reasoning — disabling it cut
        // billable output ~4x in testing with identical results.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: system },
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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return {
      text,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
  return null;
}

/** Call Claude's Messages endpoint. Returns null on error. */
async function callClaude(
  system: string,
  userContent: string,
  maxTokens: number,
  model: string,
): Promise<ModelReply | null> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    console.warn(`[ai] Claude API ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? [])
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("");
  if (!text) return null;
  return {
    text,
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

async function callProvider(
  provider: Provider,
  system: string,
  user: string,
  maxTokens: number,
  model: string,
): Promise<ModelReply | null> {
  return provider === "gemini"
    ? callGemini(system, user, maxTokens, model)
    : callClaude(system, user, maxTokens, model);
}

export interface CallOpts {
  maxTokens?: number;
  /** Override the taskClass default — e.g. ai-extract.ts's own Gemini/Claude fallback. */
  provider?: Provider;
  model?: string;
}

/**
 * Metered, budget-gated model call. Resolves provider/model from `opts`
 * (caller override) or TASK_CLASS_MODEL[taskClass], checks the tenant's
 * monthly AI budget before calling, and records actual token usage after.
 * Returns null when the budget is exhausted or the call fails — same silent-
 * degradation contract as the pre-router `aiEnabled() === false` path.
 */
export async function callByTaskClass(
  prisma: PrismaClient,
  taskClass: TaskClass,
  system: string,
  user: string,
  opts: CallOpts = {},
): Promise<string | null> {
  const provider = opts.provider ?? TASK_CLASS_MODEL[taskClass].provider;
  const model = opts.model ?? TASK_CLASS_MODEL[taskClass].model;
  const maxTokens = opts.maxTokens ?? 700;

  const budget = await meter.checkBudget(prisma);
  if (!budget.ok) {
    console.warn(
      `[ai] monthly budget exhausted ($${budget.used.toFixed(2)}/$${budget.limit}) — skipping ${taskClass} call`,
    );
    return null;
  }

  let reply: ModelReply | null;
  try {
    reply = await callProvider(provider, system, user, maxTokens, model);
  } catch (e) {
    console.warn(`[ai] callByTaskClass failed: ${(e as Error).message}`);
    return null;
  }
  if (!reply) return null;

  await meter.recordUsage(prisma, {
    provider,
    model,
    taskClass,
    promptTokens: reply.usage.promptTokens,
    completionTokens: reply.usage.completionTokens,
  });

  return reply.text;
}

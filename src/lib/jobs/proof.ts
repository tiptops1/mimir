import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";

// S4 proof job: a 3-step agent run that survives a step failure. Demonstrates
// the pattern every future agent job follows — payload is IDs only, each step
// is its own sub-60s invocation, domain state lives in Mongo (AgentEvent rows
// through the DB router), run linkage via AgentEvent.runId = Inngest run ID.

export const proofPayload = z.object({
  tenantId: z.string().min(1),
  // Simulates a transient failure on the first attempt of step 2, so the
  // per-step retry (steps 1/3 never re-run) is observable end to end.
  failOnce: z.boolean().optional().default(false),
  // Simulates a permanent failure so the onFailure → run_failed path is
  // observable without waiting out real retries.
  failAlways: z.boolean().optional().default(false),
});

export const proofRun = inngest.createFunction(
  {
    id: "system-proof-run",
    triggers: [{ event: "system/proof.requested" }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const parsed = proofPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const prisma = await tenantPrismaById(parsed.data.tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          data: { job: "proof", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId, attempt }) => {
    const { tenantId, failOnce, failAlways } = proofPayload.parse(event.data);

    await step.run("record-start", async () => {
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          data: { job: "proof" },
        },
      });
    });

    const outcome = await step.run("flaky-step", async () => {
      if (failAlways) {
        throw new Error("Simulated permanent failure (proof: run_failed path)");
      }
      if (failOnce && attempt === 0) {
        throw new Error("Simulated transient failure (proof: per-step retry)");
      }
      return { attempts: attempt + 1, survivedFailure: attempt > 0 };
    });

    await step.run("record-finish", async () => {
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          data: { job: "proof", ...outcome },
        },
      });
    });

    return { ok: true, ...outcome };
  },
);

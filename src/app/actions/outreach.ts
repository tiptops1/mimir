"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getOutreachConfig } from "@/lib/outreach/guardrails";

// Operator actions for the outreach engine: resume after a circuit-breaker
// pause, and tune the sending config from /outreach. ADMIN-only, like the
// other config surfaces.

export interface OutreachActionResult {
  error?: string;
  ok?: boolean;
}

function revalidateAll() {
  revalidatePath("/outreach");
  revalidatePath("/dashboard");
}

/** Clear the pause flag after a human has looked at why the breaker tripped. */
export async function resumeOutreach(): Promise<OutreachActionResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const config = await getOutreachConfig(prisma);
  await prisma.outreachConfig.update({
    where: { id: config.id },
    data: { paused: false, pausedReason: null, pausedAt: null },
  });
  revalidateAll();
  return { ok: true };
}

/** Manual pause (e.g. holidays, copy rework) — same flag the breaker uses. */
export async function pauseOutreachManually(): Promise<OutreachActionResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const config = await getOutreachConfig(prisma);
  await prisma.outreachConfig.update({
    where: { id: config.id },
    data: {
      paused: true,
      pausedReason: "Mise en pause manuelle.",
      pausedAt: new Date(),
    },
  });
  revalidateAll();
  return { ok: true };
}

export async function saveOutreachConfig(
  _prev: OutreachActionResult | undefined,
  formData: FormData,
): Promise<OutreachActionResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const config = await getOutreachConfig(prisma);

  const int = (name: string, fallback: number, min: number, max: number) => {
    const v = Math.round(Number(formData.get(name)));
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const time = (name: string, fallback: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
  };

  const rampRaw = String(formData.get("rampStartDate") ?? "").trim();
  const rampStartDate = rampRaw ? new Date(`${rampRaw}T00:00:00`) : null;
  if (rampRaw && Number.isNaN(rampStartDate?.getTime())) {
    return { error: "Date de début de chauffe invalide." };
  }

  const sequenceId = String(formData.get("autoEnrollSequenceId") ?? "").trim();
  if (sequenceId) {
    const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
    if (!seq || seq.mode !== "AUTO_EMAIL" || !seq.active) {
      return { error: "Séquence d'auto-inscription invalide ou inactive." };
    }
  }

  await prisma.outreachConfig.update({
    where: { id: config.id },
    data: {
      dailyCap: int("dailyCap", config.dailyCap, 1, 200),
      rampStartDate,
      rampStartCap: int("rampStartCap", config.rampStartCap, 1, 50),
      rampWeeklyIncrement: int(
        "rampWeeklyIncrement",
        config.rampWeeklyIncrement,
        1,
        50,
      ),
      sendWindowStart: time("sendWindowStart", config.sendWindowStart),
      sendWindowEnd: time("sendWindowEnd", config.sendWindowEnd),
      skipHolidays: formData.get("skipHolidays") === "on",
      bounceThresholdPct: int(
        "bounceThresholdPct",
        config.bounceThresholdPct,
        1,
        50,
      ),
      autoEnrollSequenceId: sequenceId || null,
      unsubscribeText:
        String(formData.get("unsubscribeText") ?? "").trim() ||
        config.unsubscribeText,
    },
  });
  revalidateAll();
  return { ok: true };
}

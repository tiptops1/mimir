import type { PrismaClient } from "@prisma/client";

// Materialize finance échéances into the Task worklist so trial-ends, renewals,
// and invoices-due surface in /todo, the header bell, and the daily digest — the
// same "system of action" path prospecting tasks use. Run from /api/cron next to
// advanceSequences. Deduped by financeEntryId (mirrors the activityId dedupe in
// lib/ai-extract.ts), so re-running never creates a second open task per entry.

const HORIZON_DAYS = 7;

type Alert = { title: string; date: Date; note: string };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The single most relevant upcoming alert for an entry, if any. */
function pickAlert(
  e: {
    label: string;
    status: string;
    trialEndsAt: Date | null;
    renewsAt: Date | null;
    dueDate: Date | null;
  },
  today: Date,
  horizon: Date,
): Alert | null {
  const candidates: Alert[] = [];

  if (e.dueDate && e.status !== "PAID" && e.dueDate <= horizon) {
    candidates.push({
      title: `Facture « ${e.label} » à encaisser`,
      date: e.dueDate,
      note: "Échéance de facturation — relancer le client si impayée.",
    });
  }
  if (e.trialEndsAt && e.trialEndsAt >= today && e.trialEndsAt <= horizon) {
    candidates.push({
      title: `Essai « ${e.label} » se termine — annuler ou confirmer`,
      date: e.trialEndsAt,
      note: "Fin de la période d'essai gratuit.",
    });
  }
  if (e.renewsAt && e.renewsAt >= today && e.renewsAt <= horizon) {
    candidates.push({
      title: `« ${e.label} » se renouvelle — vérifier l'abonnement`,
      date: e.renewsAt,
      note: "Renouvellement à venir — confirmer ou résilier.",
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return candidates[0];
}

export async function advanceFinanceAlerts(
  prisma: PrismaClient,
): Promise<{ created: number }> {
  const today = startOfToday();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const entries = await prisma.financeEntry.findMany({
    where: {
      OR: [
        { trialEndsAt: { gte: today, lte: horizon } },
        { renewsAt: { gte: today, lte: horizon } },
        { dueDate: { lte: horizon } },
      ],
    },
    select: {
      id: true,
      label: true,
      status: true,
      trialEndsAt: true,
      renewsAt: true,
      dueDate: true,
    },
  });

  let created = 0;
  for (const e of entries) {
    const alert = pickAlert(e, today, horizon);
    if (!alert) continue;

    // Dedupe: one open finance task per entry.
    const existing = await prisma.task.findFirst({
      where: { financeEntryId: e.id, done: false },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.task.create({
      data: {
        title: alert.title,
        type: "AUTRE",
        dueDate: alert.date,
        source: "FINANCE",
        financeEntryId: e.id,
        note: alert.note,
      },
    });
    created++;
  }

  return { created };
}

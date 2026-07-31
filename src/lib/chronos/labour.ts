// Workshop labour maths (S24). PURE — no Prisma import, margin.ts posture.
//
// The whole module exists to answer one question honestly: what did the WORK on
// this watch cost? Before S24 `ChronosConfig.labourRateCentsPerHour` was seeded
// and never read by anything, and `LABOUR` was a UnitCost kind nothing wrote —
// so every margin in the product silently valued restoration time at zero.

/** Minutes in a working hour, named so the rounding below reads deliberately. */
const MINUTES_PER_HOUR = 60;

/**
 * Cost of `minutes` at an hourly rate, in cents.
 *
 * Rounded once, at the end, to the cent — the same discipline as
 * `toBaseAmountCents`. Rounding per-minute first would drift by a few cents on
 * a long job, and those cents land in a margin figure the operator reconciles
 * against his bank.
 */
export function labourCostCents(minutes: number, rateCentsPerHour: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(rateCentsPerHour) || rateCentsPerHour <= 0) return 0;
  return Math.round((minutes / MINUTES_PER_HOUR) * rateCentsPerHour);
}

/**
 * The rate that applies to a person: their own, else the tenant's house rate.
 *
 * A person with no rate is the common case for a one-person business running a
 * single house rate — falling back is what makes filling in a per-person rate
 * optional rather than a chore.
 */
export function effectiveRateCents(
  personRateCents: number | null | undefined,
  houseRateCents: number,
): number {
  return personRateCents !== null && personRateCents !== undefined && personRateCents > 0
    ? personRateCents
    : Math.max(0, houseRateCents);
}

/** Parse "1h30", "90", "1.5h", "90m" into minutes. Null when unparseable. */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(",", ".");
  if (!raw) return null;

  // "1h30" / "1h" / "1h 30"
  const hm = raw.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)?$/);
  if (hm) {
    const hours = Number(hm[1]);
    const mins = hm[2] ? Number(hm[2]) : 0;
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins >= 60) return null;
    const total = Math.round(hours * 60 + mins);
    return total > 0 ? total : null;
  }

  // "90m" / "90"
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*m?$/);
  if (m) {
    const total = Math.round(Number(m[1]));
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  return null;
}

/** Human-readable duration: 90 → "1 h 30". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = minutes % MINUTES_PER_HOUR;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Stable identity of the cost line a work log owns. */
export function workLogDedupeKey(workLogId: string): string {
  return `work:${workLogId}`;
}

export interface LabourSummary {
  totalMinutes: number;
  totalCostCents: number;
  byPerson: Array<{ personId: string; name: string; minutes: number; costCents: number }>;
}

/** Roll work logs up per person. Pure, so the page and a script agree. */
export function summariseLabour(
  logs: Array<{ personId: string; personName: string; minutes: number; costCents: number }>,
): LabourSummary {
  const byPerson = new Map<string, { personId: string; name: string; minutes: number; costCents: number }>();

  let totalMinutes = 0;
  let totalCostCents = 0;

  for (const log of logs) {
    totalMinutes += log.minutes;
    totalCostCents += log.costCents;
    const entry = byPerson.get(log.personId) ?? {
      personId: log.personId,
      name: log.personName,
      minutes: 0,
      costCents: 0,
    };
    entry.minutes += log.minutes;
    entry.costCents += log.costCents;
    byPerson.set(log.personId, entry);
  }

  return {
    totalMinutes,
    totalCostCents,
    byPerson: [...byPerson.values()].sort((a, b) => b.costCents - a.costCents),
  };
}

// Bragi content-calendar math (S18) — all pure, no I/O, fully unit-tested.
// Dueness is computed here in code over `active: true` slots, never as a
// Mongo filter on the optional lastGeneratedPeriod (the isSet trap).

export type ContentCadence = "weekly" | "monthly";

export interface ContentSlotDueInput {
  active: boolean;
  cadence: string; // weekly | monthly — open vocab in the DB, unknown = never due
  weekday: number | null; // 1-7 ISO (weekly)
  dayOfMonth: number | null; // 1-28 (monthly)
  lastGeneratedPeriod: string | null;
}

/** ISO weekday for a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/**
 * ISO 8601 week number + week-numbering year (the Dec/Jan rollover trap:
 * Jan 1-3 can belong to the prior year's week 52/53, Dec 29-31 to the next
 * year's week 1). Standard Thursday-based algorithm.
 */
function isoWeek(date: Date): { year: number; week: number } {
  // Work on a UTC copy of the local calendar date to avoid DST edge cases.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of this ISO week — its calendar year IS the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year, week };
}

/**
 * The idempotence key for one calendar period: "2026-W29" (weekly, ISO week)
 * or "2026-07" (monthly). One proposal per slot per period.
 */
export function periodKeyFor(cadence: string, now: Date): string {
  if (cadence === "weekly") {
    const { year, week } = isoWeek(now);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Whether a slot should generate right now. Day-exact by design (S18 part 1):
 * a slot fires only when a scan runs on its trigger day — a missed day is
 * caught next period. Revisit ("due if the trigger day has passed this
 * period") when the cron lands.
 */
export function isSlotDue(slot: ContentSlotDueInput, now: Date): boolean {
  if (!slot.active) return false;
  if (slot.cadence === "weekly") {
    if (slot.weekday == null || isoWeekday(now) !== slot.weekday) return false;
  } else if (slot.cadence === "monthly") {
    if (slot.dayOfMonth == null || now.getDate() !== slot.dayOfMonth) return false;
  } else {
    return false;
  }
  return slot.lastGeneratedPeriod !== periodKeyFor(slot.cadence, now);
}

// Business-day math for the outreach send engine, in Europe/Paris civil time.
// Cold emails only leave Mon-Fri inside the configured send window; sequence
// delays count business days (J+3 over a weekend = Thursday → Tuesday). The
// scheduler (cron-job.org) is ALSO configured Mon-Fri, but the code never
// trusts it — every run re-checks.

const PARIS_TZ = "Europe/Paris";

interface ParisParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 1 = Monday … 7 = Sunday
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Civil date/time parts of `d` as seen in Paris. */
export function parisParts(d: Date): ParisParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // "24" at midnight in some ICU versions
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 1,
  };
}

/** Easter Sunday (Gregorian, anonymous algorithm) — anchors the mobile holidays. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** "MM-DD" keys of French public holidays for a year (fixed + Easter-derived). */
function frenchHolidays(year: number): Set<string> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = (m: number, d: number) => `${pad(m)}-${pad(d)}`;
  const set = new Set<string>([
    key(1, 1), // Jour de l'an
    key(5, 1), // Fête du Travail
    key(5, 8), // Victoire 1945
    key(7, 14), // Fête nationale
    key(8, 15), // Assomption
    key(11, 1), // Toussaint
    key(11, 11), // Armistice
    key(12, 25), // Noël
  ]);
  // Easter Monday (+1), Ascension (+39), Whit Monday (+50) via UTC date math.
  const easter = easterSunday(year);
  for (const offset of [1, 39, 50]) {
    const d = new Date(Date.UTC(year, easter.month - 1, easter.day + offset));
    set.add(key(d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return set;
}

/** Mon-Fri and (optionally) not a French public holiday, in Paris time. */
export function isBusinessDay(d: Date, opts: { skipHolidays?: boolean } = {}): boolean {
  const p = parisParts(d);
  if (p.weekday >= 6) return false;
  if (opts.skipHolidays !== false) {
    const pad = (n: number) => String(n).padStart(2, "0");
    if (frenchHolidays(p.year).has(`${pad(p.month)}-${pad(p.day)}`)) return false;
  }
  return true;
}

/** Is `d` inside the "HH:MM"–"HH:MM" Paris send window? */
export function isWithinSendWindow(d: Date, start: string, end: string): boolean {
  const p = parisParts(d);
  const minutes = p.hour * 60 + p.minute;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return minutes >= toMin(start) && minutes <= toMin(end);
}

const DAY = 86_400_000;

/**
 * `start` advanced by `n` BUSINESS days (skipping weekends/holidays), keeping
 * the time-of-day. n=0 returns start unchanged — the send window check is what
 * gates the actual send moment.
 */
export function addBusinessDays(
  start: Date,
  n: number,
  opts: { skipHolidays?: boolean } = {},
): Date {
  let d = new Date(start.getTime());
  let left = Math.max(0, Math.round(n));
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isBusinessDay(d, opts)) left--;
  }
  return d;
}

/**
 * How many hourly scheduler runs remain today INCLUDING this one, given the
 * window end "HH:MM" — used to spread the remaining daily budget evenly.
 */
export function remainingRunsToday(now: Date, windowEnd: string): number {
  const p = parisParts(now);
  const [eh, em] = windowEnd.split(":").map(Number);
  const left = (eh || 0) * 60 + (em || 0) - (p.hour * 60 + p.minute);
  return Math.max(1, Math.floor(left / 60) + 1);
}

/** The UTC instant when today's Paris civil day started (for daily-cap counts). */
export function startOfParisDay(now: Date): Date {
  const p = parisParts(now);
  // Paris is UTC+1 or UTC+2; try both candidate offsets and keep the one that
  // lands on the same civil date at 00:xx.
  for (const offsetH of [1, 2]) {
    const candidate = new Date(
      Date.UTC(p.year, p.month - 1, p.day, -offsetH, 0, 0, 0),
    );
    const q = parisParts(candidate);
    if (q.year === p.year && q.month === p.month && q.day === p.day && q.hour === 0) {
      return candidate;
    }
  }
  // Fallback (never expected): midnight UTC of the civil date.
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

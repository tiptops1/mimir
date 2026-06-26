import type { PrismaClient } from "@prisma/client";
import { companyName } from "./display";
import {
  monthlyAmount,
  countsInRunRate,
  type FinanceRow,
  type FinanceDirection,
  type FinanceKind,
  type Recurrence,
} from "./finance";

// Server-side aggregation for the Finances cockpit, shared by /finances and the
// dashboard P&L strip. One pass over the tenant's FinanceEntry rows.

export interface RadarItem {
  id: string;
  label: string;
  type: "Essai" | "Renouv." | "Facture";
  badge: string;
  dateIso: string;
  days: number;
  amount: number;
}

export interface FinanceCockpit {
  entryCount: number;
  costThisMonth: number;
  incomeThisMonth: number;
  net: number;
  costRunRate: number;
  incomeRunRate: number;
  openPipeline: number;
  radar: RadarItem[];
  byCategory: { name: string; value: number }[];
  rows: FinanceRow[];
}

type EntryWithCompany = {
  id: string;
  direction: string;
  kind: string;
  label: string;
  vendor: string | null;
  category: string | null;
  amount: number;
  currency: string;
  recurrence: string;
  status: string;
  date: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  trialEndsAt: Date | null;
  renewsAt: Date | null;
  dueDate: Date | null;
  autoRenew: boolean;
  notes: string | null;
  company: {
    id: string;
    nomSociete: string | null;
    enseigne: string | null;
    siret: string | null;
  } | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function serializeFinanceRow(e: EntryWithCompany): FinanceRow {
  return {
    id: e.id,
    direction: e.direction as FinanceDirection,
    kind: e.kind as FinanceKind,
    label: e.label,
    vendor: e.vendor,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    recurrence: e.recurrence as Recurrence,
    status: e.status,
    date: iso(e.date),
    startDate: iso(e.startDate),
    endDate: iso(e.endDate),
    trialEndsAt: iso(e.trialEndsAt),
    renewsAt: iso(e.renewsAt),
    dueDate: iso(e.dueDate),
    autoRenew: e.autoRenew,
    notes: e.notes,
    company: e.company
      ? { id: e.company.id, name: companyName(e.company) }
      : null,
  };
}

export async function computeFinanceCockpit(
  prisma: PrismaClient,
): Promise<FinanceCockpit> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);

  const [entries, dealAgg] = await Promise.all([
    prisma.financeEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        company: {
          select: { id: true, nomSociete: true, enseigne: true, siret: true },
        },
      },
    }),
    prisma.deal.aggregate({ _sum: { amount: true }, where: { status: "OPEN" } }),
  ]);

  let costRunRate = 0;
  let incomeRunRate = 0;
  let costOneOff = 0;
  let incomePaid = 0;
  const byCat = new Map<string, number>();
  const radar: RadarItem[] = [];

  const days = (d: Date) =>
    Math.round((d.getTime() - today.getTime()) / 86_400_000);

  for (const e of entries) {
    const live = countsInRunRate(e);
    if (live) {
      if (e.direction === "OUT") costRunRate += monthlyAmount(e);
      else incomeRunRate += monthlyAmount(e);
    }
    const oneOffThisMonth =
      e.recurrence === "NONE" &&
      e.date &&
      e.date >= startOfMonth &&
      e.date < startOfNextMonth;
    if (oneOffThisMonth) {
      if (e.direction === "OUT") costOneOff += e.amount;
      else if (e.status === "PAID") incomePaid += e.amount;
    }

    // Monthly cost contribution per category (recurring run-rate + one-off this month).
    if (e.direction === "OUT") {
      const contrib = live ? monthlyAmount(e) : oneOffThisMonth ? e.amount : 0;
      if (contrib > 0) {
        const c = e.category ?? "Autre";
        byCat.set(c, (byCat.get(c) ?? 0) + contrib);
      }
    }

    // Échéances radar: trials/renewals in the next 30 days; unpaid invoices due (incl. overdue).
    if (e.trialEndsAt && e.trialEndsAt >= today && e.trialEndsAt <= in30) {
      radar.push({
        id: e.id,
        label: e.label,
        type: "Essai",
        badge: "bg-rose-100 text-rose-700",
        dateIso: e.trialEndsAt.toISOString(),
        days: days(e.trialEndsAt),
        amount: e.amount,
      });
    }
    if (
      e.renewsAt &&
      e.renewsAt >= today &&
      e.renewsAt <= in30 &&
      e.status !== "CANCELLED"
    ) {
      radar.push({
        id: e.id,
        label: e.label,
        type: "Renouv.",
        badge: "bg-sky-100 text-sky-700",
        dateIso: e.renewsAt.toISOString(),
        days: days(e.renewsAt),
        amount: e.amount,
      });
    }
    if (e.dueDate && e.status !== "PAID" && e.dueDate <= in30) {
      radar.push({
        id: e.id,
        label: e.label,
        type: "Facture",
        badge: "bg-amber-100 text-amber-700",
        dateIso: e.dueDate.toISOString(),
        days: days(e.dueDate),
        amount: e.amount,
      });
    }
  }

  radar.sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  const costThisMonth = Math.round(costRunRate + costOneOff);
  const incomeThisMonth = Math.round(incomeRunRate + incomePaid);

  const byCategory = [...byCat.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);

  return {
    entryCount: entries.length,
    costThisMonth,
    incomeThisMonth,
    net: incomeThisMonth - costThisMonth,
    costRunRate: Math.round(costRunRate),
    incomeRunRate: Math.round(incomeRunRate),
    openPipeline: dealAgg._sum.amount ?? 0,
    radar,
    byCategory,
    rows: entries.map(serializeFinanceRow),
  };
}

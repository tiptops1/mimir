"use client";

import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
  ComposedChart,
  Line,
  CartesianGrid,
} from "recharts";

export interface ChartDatum {
  name: string;
  value: number;
  color?: string;
  // When set, clicking the bar/slice navigates here (drill-down).
  href?: string;
}

/*
 * Recharts renders colors as SVG presentation attributes, which resolve `var()`
 * — so the design tokens reach the chart the same way they reach everything
 * else, and dark mode stays a free token swap (C4). The primary series takes
 * the REALM hue: charts in Trésor glow emerald, in Chasse cyan, with no
 * per-page chart code. Data-supplied colors (stage/priority hues from
 * StageDefinition.badgeClass' sibling STAGE_HEX) still win — those are data.
 */
/* --muted, not --faint: axis labels are data a user reads, and --faint on the
 * dark card is only 3.2:1. --muted clears 4.5:1 in both themes (4.9 / 6.3). */
const AXIS = { fontSize: 12, fill: "var(--muted)" };

/** Realm-tinted hover band behind the focused category. */
const CURSOR = { fill: "color-mix(in srgb, var(--realm) 8%, transparent)" };

const TOOLTIP = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--card)",
    boxShadow: "var(--shadow-lg)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--foreground)" },
} as const;

const LEGEND = { fontSize: 12, color: "var(--muted)" };

/** Shared hook: navigate to a datum's href on click, if it has one. */
function useDrill() {
  const router = useRouter();
  return (d?: { payload?: ChartDatum }) => {
    const href = d?.payload?.href;
    if (href) router.push(href);
  };
}

export function VerticalBars({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <XAxis
          dataKey="name"
          tick={AXIS}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={70}
        />
        <YAxis tick={AXIS} allowDecimals={false} />
        <Tooltip cursor={CURSOR} {...TOOLTIP} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "var(--realm)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ data }: { data: ChartDatum[] }) {
  const drill = useDrill();
  const clickable = data.some((d) => d.href);
  return (
    <div>
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <XAxis type="number" tick={AXIS} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={AXIS}
          width={120}
        />
        <Tooltip cursor={CURSOR} {...TOOLTIP} />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          className={clickable ? "cursor-pointer" : undefined}
          onClick={clickable ? drill : undefined}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "var(--realm)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {clickable && (
      <p className="mt-1 text-center text-xs text-muted">
        Cliquez sur une barre pour filtrer la liste.
      </p>
    )}
    </div>
  );
}

export interface DualDatum {
  name: string;
  won: number;
  lost: number;
}

/** Two-series monthly bars (gagnés vs perdus) for the win-rate trend. */
export function DualBars({ data }: { data: DualDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <XAxis dataKey="name" tick={AXIS} interval={0} />
        <YAxis tick={AXIS} allowDecimals={false} />
        <Tooltip cursor={CURSOR} {...TOOLTIP} />
        <Legend iconType="circle" wrapperStyle={LEGEND} />
        {/* Won/lost is semantic, not realm — outcome color must not drift with
            the realm you happen to be standing in. */}
        <Bar
          dataKey="won"
          name="Gagnés"
          fill="var(--success)"
          radius={[6, 6, 0, 0]}
        />
        <Bar
          dataKey="lost"
          name="Perdus"
          fill="var(--danger)"
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface PnlDatum {
  name: string;
  /** Whole units of currency, not cents — the caller divides. */
  revenue: number;
  cost: number;
  net: number;
}

const EUR_COMPACT = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/**
 * Monthly P&L: money in, money out, and what survived.
 *
 * Colours are semantic and fixed rather than realm-derived — revenue, cost and
 * net margin mean the same thing on any surface, so they must not drift with
 * the realm you happen to be standing in (same rule as DualBars above). They
 * come from the chart-series tokens, in the order docs/chronos/BRAND.md §2.4
 * sets: sapphire for money in, amber for money out, the realm's own hue for the
 * line, since "what's left" IS the Trésor question.
 *
 * The net line carries the meaning here, so it draws ON TOP of the bars, and
 * the axis is compact ("12 k€") — a monthly P&L is read as a shape first.
 */
export function PnlChart({ data }: { data: PnlDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} interval="preserveStartEnd" />
        <YAxis tick={AXIS} tickFormatter={(v: number) => EUR_COMPACT.format(v)} />
        <Tooltip
          cursor={CURSOR}
          {...TOOLTIP}
          // Recharts types the value as possibly-undefined; a bar with no datum
          // must render as "—", not "NaN €".
          formatter={(v) => (v == null ? "—" : EUR.format(Number(v)))}
        />
        <Legend iconType="circle" wrapperStyle={LEGEND} />
        <Bar
          dataKey="revenue"
          name="Chiffre d'affaires"
          fill="var(--chart-3)"
          radius={[6, 6, 0, 0]}
        />
        <Bar dataKey="cost" name="Coûts" fill="var(--chart-5)" radius={[6, 6, 0, 0]} />
        <Line
          type="monotone"
          dataKey="net"
          name="Marge nette"
          stroke="var(--realm)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--realm)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data }: { data: ChartDatum[] }) {
  const drill = useDrill();
  const clickable = data.some((d) => d.href);
  return (
    <div>
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          className={clickable ? "cursor-pointer" : undefined}
          onClick={clickable ? drill : undefined}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "var(--realm)"} />
          ))}
        </Pie>
        <Legend iconType="circle" wrapperStyle={LEGEND} />
        <Tooltip {...TOOLTIP} />
      </PieChart>
    </ResponsiveContainer>
    {clickable && (
      <p className="mt-1 text-center text-xs text-muted">
        Cliquez sur un segment pour filtrer la liste.
      </p>
    )}
    </div>
  );
}

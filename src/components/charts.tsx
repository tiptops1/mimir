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
} from "recharts";

export interface ChartDatum {
  name: string;
  value: number;
  color?: string;
  // When set, clicking the bar/slice navigates here (drill-down).
  href?: string;
}

const AXIS = { fontSize: 12, fill: "#64748b" };

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
        <Tooltip
          cursor={{ fill: "rgba(79,70,229,0.06)" }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "#4f46e5"} />
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
        <Tooltip
          cursor={{ fill: "rgba(79,70,229,0.06)" }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          className={clickable ? "cursor-pointer" : undefined}
          onClick={clickable ? drill : undefined}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "#4f46e5"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {clickable && (
      <p className="mt-1 text-center text-xs text-muted">
        Cliquez sur une barre pour filtrer les sociétés.
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
        <Tooltip
          cursor={{ fill: "rgba(79,70,229,0.06)" }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="won" name="Gagnés" fill="#10b981" radius={[6, 6, 0, 0]} />
        <Bar dataKey="lost" name="Perdus" fill="#fb7185" radius={[6, 6, 0, 0]} />
      </BarChart>
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
            <Cell key={i} fill={d.color ?? "#4f46e5"} />
          ))}
        </Pie>
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
    {clickable && (
      <p className="mt-1 text-center text-xs text-muted">
        Cliquez sur un segment pour filtrer les sociétés.
      </p>
    )}
    </div>
  );
}

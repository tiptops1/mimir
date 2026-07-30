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
  LabelList,
} from "recharts";

export interface FunnelDatum {
  name: string;
  value: number;
  color?: string;
  stage: string;
}

/* Token-driven like charts.tsx — see the note there on var() in SVG
 * presentation attributes and why the realm hue is the primary-series default. */
const AXIS = { fontSize: 12, fill: "var(--muted)" };

/**
 * Stage funnel where each bar is clickable — navigates to the pipeline board
 * and highlights that stage's column.
 */
export function FunnelChart({ data }: { data: FunnelDatum[] }) {
  const router = useRouter();

  function go(stage?: string) {
    if (stage) router.push(`/pipeline?stage=${stage}`);
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 8 }}>
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
            cursor={{ fill: "color-mix(in srgb, var(--realm) 8%, transparent)" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--card)",
              boxShadow: "var(--shadow-lg)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--foreground)" }}
          />
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            className="cursor-pointer"
            onClick={(d: { payload?: FunnelDatum }) => go(d.payload?.stage)}
          >
            <LabelList dataKey="value" position="top" style={AXIS} />
            {data.map((d, i) => (
              <Cell key={i} fill={d.color ?? "var(--realm)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-xs text-muted">
        Cliquez sur une étape pour l&apos;ouvrir dans le pipeline.
      </p>
    </div>
  );
}

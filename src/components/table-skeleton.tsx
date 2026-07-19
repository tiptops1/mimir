import { Card } from "@/components/ui";

/** Suspense fallback matching the shape of a list table (C3 reveal handoff). */
export function TableSkeleton({
  columns,
  rows = 8,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-2.5">
                  <div className="h-2.5 w-16 animate-pulse rounded bg-surface-2" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-b border-border last:border-0">
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    <div
                      className="h-3.5 animate-pulse rounded bg-surface-2"
                      style={{ width: `${45 + ((r * 7 + c * 13) % 40)}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

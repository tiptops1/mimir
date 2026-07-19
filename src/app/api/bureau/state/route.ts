import { NextResponse } from "next/server";

import { getOptionalSession } from "@/lib/dal";
import { listRecentAgentEvents } from "@/lib/nornir/queries";
import { getTenantDb } from "@/lib/tenant-context";

/**
 * Le Bureau — live agent state for the pixel office (C5).
 * Recent ledger events + pending-proposal counts per module; the client
 * translates these into webview animation messages (see components/bureau/).
 */
export async function GET() {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const prisma = await getTenantDb();

  const [events, pending] = await Promise.all([
    listRecentAgentEvents(prisma, { limit: 30 }),
    prisma.agentAction.groupBy({
      by: ["module"],
      where: { status: "PROPOSED" },
      _count: { _all: true },
    }),
  ]);

  return NextResponse.json({
    pendingByModule: Object.fromEntries(pending.map((p) => [p.module, p._count._all])),
    events: events.map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      module: e.module,
      category: e.category,
      action: e.action,
    })),
  });
}

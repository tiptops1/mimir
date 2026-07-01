import type { PrismaClient } from "@prisma/client";

// Append-only audit trail (P2.4 RGPD). Call for destructive or PII-relevant
// actions; never let a logging failure break the action itself.

export async function logAudit(
  prisma: PrismaClient,
  args: {
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    details?: string;
  },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: args.userId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId ?? null,
        details: args.details,
      },
    });
  } catch {
    // The audited action must not fail because the log write did.
  }
}

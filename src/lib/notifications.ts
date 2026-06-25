import type { PrismaClient, PipelineStage } from "@prisma/client";
import { companyName } from "./display";

// "What needs my attention" — computed from existing data (no new model): open
// tasks overdue/due-today + engaged prospects gone cold (>30 days, not won/lost).
// Powers the header bell and the daily email digest.

export interface NotificationItem {
  id: string;
  label: string;
  sub: string;
  href: string;
}

export interface NotificationSummary {
  taskCount: number;
  staleCount: number;
  total: number;
  items: NotificationItem[];
}

export async function getNotificationSummary(
  prisma: PrismaClient,
): Promise<NotificationSummary> {
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - 30);

  const staleWhere = {
    dernierContact: { not: null, lt: staleBefore },
    stage: { notIn: ["GAGNE", "PERDU"] as PipelineStage[] },
  };
  const taskWhere = { done: false, dueDate: { not: null, lt: startOfTomorrow } };

  const [taskCount, staleCount, dueTop, staleTop] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.company.count({ where: staleWhere }),
    prisma.task.findMany({
      where: taskWhere,
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { id: true, title: true },
    }),
    prisma.company.findMany({
      where: staleWhere,
      orderBy: { dernierContact: "asc" },
      take: 5,
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
    }),
  ]);

  const items: NotificationItem[] = [
    ...dueTop.map((t) => ({
      id: `t-${t.id}`,
      label: t.title,
      sub: "Tâche à faire",
      href: "/todo",
    })),
    ...staleTop.map((c) => ({
      id: `c-${c.id}`,
      label: companyName(c),
      sub: "Prospect à relancer",
      href: `/companies/${c.id}`,
    })),
  ];

  return { taskCount, staleCount, total: taskCount + staleCount, items };
}

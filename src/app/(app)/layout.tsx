import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { Sidebar } from "@/components/sidebar";
import { GlobalSearch } from "@/components/global-search";
import { QuickAddMenu } from "@/components/quick-add-menu";
import { NotificationsBell } from "@/components/notifications-bell";
import { getNotificationSummary } from "@/lib/notifications";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();

  // "todo" badge = what needs attention now: open tasks overdue or due today.
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [pendingCount, todoCount, notifications] = await Promise.all([
    prisma.pendingContact.count({ where: { status: "PENDING" } }),
    prisma.task.count({
      where: { done: false, dueDate: { not: null, lt: startOfTomorrow } },
    }),
    getNotificationSummary(prisma),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        pendingCount={pendingCount}
        todoCount={todoCount}
        user={{
          name: session.name,
          email: session.email,
          role: session.role,
        }}
      />
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-card/95 px-6 py-3 backdrop-blur">
          <GlobalSearch />
          <QuickAddMenu />
          <NotificationsBell summary={notifications} />
        </header>
        {children}
      </main>
    </div>
  );
}

import { ViewTransition } from "react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { RealmScope } from "@/components/realm-scope";
import { Sidebar } from "@/components/sidebar";
import { MobileSidebar } from "@/components/mobile-sidebar";
import { GlobalSearch } from "@/components/global-search";
import { QuickAddMenu } from "@/components/quick-add-menu";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
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

  const [pendingCount, todoCount, leadOneCount, heimdallrPendingCount, notifications] =
    await Promise.all([
      prisma.pendingContact.count({ where: { status: "PENDING" } }),
      prisma.task.count({
        where: { done: false, dueDate: { not: null, lt: startOfTomorrow } },
      }),
      prisma.leadCandidate.count({ where: { status: "VALIDATED" } }),
      prisma.agentAction.count({ where: { status: "PROPOSED" } }),
      getNotificationSummary(prisma),
    ]);

  const user = {
    name: session.name,
    email: session.email,
    role: session.role,
  };

  return (
    <RealmScope>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          className="hidden lg:flex"
          pendingCount={pendingCount}
          todoCount={todoCount}
          leadOneCount={leadOneCount}
          heimdallrPendingCount={heimdallrPendingCount}
          user={user}
        />
        <main className="flex-1 overflow-y-auto bg-background">
          <header
            style={{ viewTransitionName: "cosmos-topbar" }}
            className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-card/70 sm:px-6"
          >
            <MobileSidebar
              pendingCount={pendingCount}
              todoCount={todoCount}
              leadOneCount={leadOneCount}
              heimdallrPendingCount={heimdallrPendingCount}
              user={user}
            />
            <GlobalSearch isAdmin={session.role === "ADMIN"} />
            <div className="ml-auto flex items-center gap-2">
              <QuickAddMenu />
              <ThemeToggle />
              <NotificationsBell summary={notifications} />
            </div>
          </header>
          <ViewTransition
            enter={{
              "realm-shift": "realm-shift",
              "nav-forward": "nav-forward",
              "nav-back": "nav-back",
              default: "none",
            }}
            exit={{
              "realm-shift": "realm-shift",
              "nav-forward": "nav-forward",
              "nav-back": "nav-back",
              default: "none",
            }}
            default="none"
          >
            {children}
          </ViewTransition>
        </main>
      </div>
    </RealmScope>
  );
}

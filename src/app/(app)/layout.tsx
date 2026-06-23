import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/sidebar";
import { GlobalSearch } from "@/components/global-search";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  const pendingCount = await prisma.pendingContact.count({
    where: { status: "PENDING" },
  });

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        pendingCount={pendingCount}
        user={{
          name: session.name,
          email: session.email,
          role: session.role,
        }}
      />
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-40 flex items-center border-b border-border bg-card/95 px-6 py-3 backdrop-blur">
          <GlobalSearch />
        </header>
        {children}
      </main>
    </div>
  );
}

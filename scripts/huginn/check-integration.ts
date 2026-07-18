import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";

const control = new ControlClient();

async function main() {
  const rows = await control.integration.findMany({
    where: { provider: "google" },
    select: { tenantId: true, purpose: true, accountEmail: true, status: true, connectedAt: true, scopes: true },
  });
  console.log(JSON.stringify(rows, null, 1));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => control.$disconnect());

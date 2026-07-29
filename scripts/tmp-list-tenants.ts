import "dotenv/config";
import { PrismaClient } from "../src/generated/control";
const c = new PrismaClient();
async function main() {
  const t = await c.tenant.findMany({ select: { id: true, slug: true, brandName: true, brandLogoUrl: true, modules: true, status: true } });
  console.log(t);
  const u = await c.user.findMany({ select: { email: true, memberships: true } });
  console.log(JSON.stringify(u, null, 1));
  await c.$disconnect();
}
main();

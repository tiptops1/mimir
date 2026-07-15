import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient as ControlClient } from "../src/generated/control";

/**
 * Add (or update) a login account in the control plane and attach it to a tenant.
 *
 *   npm run user:add -- --email a@b.c --password secret [--name "Jane"] \
 *                       [--role ADMIN|MANAGER|USER] [--tenant crm_demo]
 *
 * Idempotent: re-running with the same email resets that user's password/name and
 * ensures the membership/role. Requires CONTROL_DATABASE_URL.
 */

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = arg("--email")?.toLowerCase();
  const password = arg("--password");
  const name = arg("--name") ?? null;
  const role = (arg("--role", "ADMIN") as "ADMIN" | "MANAGER" | "USER");
  const slug = arg("--tenant", "crm_demo")!;

  if (!email || !password) {
    throw new Error("Usage: --email <email> --password <password> [--name] [--role] [--tenant]");
  }
  if (!process.env.CONTROL_DATABASE_URL) {
    throw new Error("CONTROL_DATABASE_URL is not set");
  }

  const control = new ControlClient({ datasourceUrl: process.env.CONTROL_DATABASE_URL });
  try {
    const tenant = await control.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Tenant "${slug}" not found in the control plane.`);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await control.user.upsert({
      where: { email },
      update: { name, passwordHash },
      create: { email, name, passwordHash },
    });

    await control.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      update: { role },
      create: { userId: user.id, tenantId: tenant.id, role },
    });

    console.log(`✓ ${email} ready as ${role} on tenant "${slug}" (${tenant.name}).`);
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

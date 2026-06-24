import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { encrypt } from "../src/lib/crypto";

/**
 * One-time Phase 0 bootstrap: stand up the control plane and adopt Christopher's
 * existing live DB AS tenant #1 — "promote in place", so NO tenant data moves.
 *
 *   npm run tenant:bootstrap
 *
 * Requires CONTROL_DATABASE_URL (new, empty control DB), DATABASE_URL (Chris's
 * existing data DB = tenant #1) and ENCRYPTION_KEY. Idempotent (upserts).
 */

const TENANT1_SLUG = "crm_chris";
const TENANT1_NAME = "Avelior — Christopher";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

interface LegacyUser {
  email: string;
  name?: string | null;
  passwordHash: string;
  role?: "ADMIN" | "MANAGER" | "USER" | null;
}

async function main() {
  const controlUrl = required("CONTROL_DATABASE_URL");
  const tenant1Url = required("DATABASE_URL");
  required("ENCRYPTION_KEY"); // fail fast if missing before we write anything

  const control = new ControlClient({ datasourceUrl: controlUrl });
  // The tenant schema no longer has a User model, so read the legacy "User"
  // collection straight from the data DB via a raw command (role included).
  const legacy = new ControlClient({ datasourceUrl: tenant1Url });

  try {
    const raw = (await legacy.$runCommandRaw({
      find: "User",
      filter: {},
      batchSize: 1000,
    })) as unknown as { cursor?: { firstBatch?: LegacyUser[] } };
    const users = raw.cursor?.firstBatch ?? [];
    console.log(`Found ${users.length} existing user(s) in tenant #1's DB.`);

    const tenant = await control.tenant.upsert({
      where: { slug: TENANT1_SLUG },
      update: {
        name: TENANT1_NAME,
        connectionString: encrypt(tenant1Url),
        status: "ACTIVE",
      },
      create: {
        slug: TENANT1_SLUG,
        name: TENANT1_NAME,
        connectionString: encrypt(tenant1Url),
        status: "ACTIVE",
      },
    });
    console.log(`✓ Tenant #1 ready: ${tenant.slug} (${tenant.id})`);

    for (const u of users) {
      if (!u.email || !u.passwordHash) continue;
      const user = await control.user.upsert({
        where: { email: u.email },
        update: { name: u.name ?? null, passwordHash: u.passwordHash },
        create: {
          email: u.email,
          name: u.name ?? null,
          passwordHash: u.passwordHash,
        },
      });
      await control.membership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        update: { role: u.role ?? "USER" },
        create: { userId: user.id, tenantId: tenant.id, role: u.role ?? "USER" },
      });
      console.log(`  ✓ ${u.email} → membership (${u.role ?? "USER"})`);
    }

    console.log("✓ Control plane bootstrapped. Tenant #1 promoted in place.");
  } finally {
    await Promise.all([control.$disconnect(), legacy.$disconnect()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

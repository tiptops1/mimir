import "dotenv/config";
import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { encrypt } from "../src/lib/crypto";

/**
 * Provision a NEW tenant: create its isolated data DB on the cluster, register
 * it in the control plane, and seed an admin login. This is "Phase 0 on demand"
 * — the same path Phase 4's self-serve onboarding will call.
 *
 *   npm run tenant:provision -- --slug demo --name "Demo" \
 *     --admin-email admin@demo.test --admin-password "secret"
 *
 * Requires CONTROL_DATABASE_URL, ENCRYPTION_KEY and CLUSTER_BASE_URL (a base
 * connection string whose DB-name path is swapped for the tenant slug).
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Derive the tenant's connection string from CLUSTER_BASE_URL + slug as DB name. */
function tenantConnectionString(slug: string): string {
  const url = new URL(required("CLUSTER_BASE_URL"));
  url.pathname = `/${slug}`;
  return url.toString();
}

async function main() {
  const controlUrl = required("CONTROL_DATABASE_URL");
  required("ENCRYPTION_KEY");

  const slug = arg("slug");
  const adminEmail = arg("admin-email");
  const adminPassword = arg("admin-password");
  if (!slug || !adminEmail || !adminPassword) {
    throw new Error(
      "Usage: tenant:provision -- --slug <slug> --name <name> " +
        "--admin-email <email> --admin-password <password>",
    );
  }
  const name = arg("name") ?? slug;

  const connectionString = tenantConnectionString(slug);

  // 1) Create the tenant's collections + indexes by pushing the tenant schema
  //    against its (brand-new) DB. Mongo creates the DB lazily on first write.
  console.log(`Provisioning data DB for "${slug}"…`);
  execSync("npx prisma db push --schema=prisma/tenant/schema.prisma --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: connectionString },
  });

  // 2) Register the tenant + admin login in the control plane.
  const control = new ControlClient({ datasourceUrl: controlUrl });
  try {
    const tenant = await control.tenant.upsert({
      where: { slug },
      update: { name, connectionString: encrypt(connectionString), status: "ACTIVE" },
      create: {
        slug,
        name,
        connectionString: encrypt(connectionString),
        status: "ACTIVE",
      },
    });
    console.log(`✓ Tenant registered: ${tenant.slug} (${tenant.id})`);

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const user = await control.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash },
      create: { email: adminEmail, name: `${name} admin`, passwordHash },
    });
    await control.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      update: { role: "ADMIN" },
      create: { userId: user.id, tenantId: tenant.id, role: "ADMIN" },
    });
    console.log(`✓ Admin ready: ${adminEmail} (ADMIN of ${slug})`);
    console.log("✓ Tenant provisioned. Empty CRM, fully isolated.");
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

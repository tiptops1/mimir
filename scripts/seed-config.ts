import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { decrypt } from "../src/lib/crypto";
import { seedTenantConfig } from "../src/lib/default-config";
import { assertProdAllowed } from "./lib/guard";

assertProdAllowed();

// Seed the default tenant config (stages / field defs / autonomy / prompts).
// Idempotent — safe to re-run. The seed data itself lives in
// src/lib/default-config.ts, shared with self-serve provisioning
// (src/lib/provision.ts).
//
//   npm run config:seed -- --slug chronos_demo   // resolve tenant + its modules
//   npm run config:seed                          // fall back to DATABASE_URL
//   npm run config:seed -- --modules chronos     // override the module list
//
// `--slug` resolves the tenant through the control plane and uses the modules
// RECORDED ON IT, so the config a tenant gets always matches what it actually
// bought. Before S32 this script accepted no slug at all: it always wrote to
// DATABASE_URL and always defaulted to `crm`, so `--slug chronos_demo` was
// silently ignored and CRM config went to whichever database DATABASE_URL
// happened to name. That is the same defect S28 fixed across eight route
// handlers and `db:push`, missed here.

const controlClient = new ControlClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolve(): Promise<{ prisma: PrismaClient; modules: string[]; target: string }> {
  const slug = arg("slug");
  const modulesArg = arg("modules");

  if (slug) {
    const tenant = await controlClient.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Unknown tenant: ${slug}`);
    return {
      prisma: new PrismaClient({ datasourceUrl: decrypt(tenant.connectionString) }),
      // An explicit --modules still wins, for the rare re-seed of a tenant
      // mid-entitlement-change; otherwise the control plane is the authority.
      modules: modulesArg ? modulesArg.split(",").map((m) => m.trim()).filter(Boolean) : tenant.modules,
      target: slug,
    };
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("No --slug given and DATABASE_URL is not set.");
  }
  return {
    prisma: new PrismaClient(),
    modules: (modulesArg ?? "crm").split(",").map((m) => m.trim()).filter(Boolean),
    target: new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") || "DATABASE_URL",
  };
}

async function main() {
  const { prisma, modules, target } = await resolve();

  console.log(`Seeding config into "${target}" — modules: ${modules.join(", ") || "(none)"}`);
  await seedTenantConfig(prisma, { modules });

  const [fieldCount, stageCount, autonomyCount, promptCount] = await Promise.all([
    prisma.fieldDefinition.count(),
    prisma.stageDefinition.count(),
    prisma.autonomyConfig.count(),
    prisma.promptTemplate.count(),
  ]);
  console.log(
    `✓ ${stageCount} stages · ${fieldCount} field definitions · ` +
      `${autonomyCount} autonomy categories · ${promptCount} prompts.`,
  );

  await prisma.$disconnect();
  await controlClient.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await controlClient.$disconnect();
  process.exit(1);
});

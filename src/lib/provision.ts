import bcrypt from "bcryptjs";
import { controlPrisma } from "@/lib/control-db";
import { encrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { seedTenantConfig } from "@/lib/default-config";
import { logAudit } from "@/lib/audit";

// Phase 4 self-serve onboarding: provision a new tenant from the running app —
// the server-action equivalent of scripts/provision-tenant.ts (which shells out
// to `prisma db push` and can't run inside a request). Mongo creates the DB and
// collections lazily; the uniqueness constraints the app's CORRECTNESS relies
// on are created explicitly below (Prisma db-push naming, so a later full
// `db push` per tenant is a no-op on them). The remaining perf-only indexes
// arrive with that later db push.

export const SLUG_RE = /^[a-z][a-z0-9_]{2,30}$/;

/** Uniques the app logic depends on (dedupe keys, upsert targets). */
const UNIQUE_INDEXES: Array<{
  collection: string;
  name: string;
  key: Record<string, 1>;
}> = [
  { collection: "Company", name: "Company_siret_key", key: { siret: 1 } },
  { collection: "StageDefinition", name: "StageDefinition_key_key", key: { key: 1 } },
  { collection: "FieldDefinition", name: "FieldDefinition_entity_key_key", key: { entity: 1, key: 1 } },
  { collection: "Setting", name: "Setting_key_key", key: { key: 1 } },
  { collection: "SyncCursor", name: "SyncCursor_source_key", key: { source: 1 } },
  { collection: "EmailSyncState", name: "EmailSyncState_mailbox_key", key: { mailbox: 1 } },
  { collection: "BlockedSender", name: "BlockedSender_value_key", key: { value: 1 } },
];

/** Derive the tenant's connection string from CLUSTER_BASE_URL + slug as DB name. */
export function tenantConnectionString(slug: string): string {
  const base = process.env.CLUSTER_BASE_URL;
  if (!base) throw new Error("CLUSTER_BASE_URL is not set");
  const url = new URL(base);
  url.pathname = `/${slug}`;
  return url.toString();
}

export interface ProvisionArgs {
  slug: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
}

export interface ProvisionOutcome {
  error?: string;
  ok?: boolean;
  tenantId?: string;
}

export async function provisionTenant(
  args: ProvisionArgs,
  actorUserId?: string,
): Promise<ProvisionOutcome> {
  const slug = args.slug.trim().toLowerCase();
  const name = args.name.trim();
  const adminEmail = args.adminEmail.trim().toLowerCase();

  if (!SLUG_RE.test(slug)) {
    return { error: "Slug invalide (minuscules/chiffres/_, 3-31 caractères, commence par une lettre)." };
  }
  if (!name) return { error: "Le nom est requis." };
  if (!/.+@.+\..+/.test(adminEmail)) return { error: "Email admin invalide." };
  if (args.adminPassword.length < 8) {
    return { error: "Mot de passe : 8 caractères minimum." };
  }

  const existing = await controlPrisma.tenant.findUnique({ where: { slug } });
  if (existing) return { error: "Ce slug existe déjà." };

  const connectionString = tenantConnectionString(slug);
  const tenantPrisma = getTenantPrisma(connectionString);

  // 1) Reachability first — fail before anything is registered.
  try {
    await tenantPrisma.$runCommandRaw({ ping: 1 });
  } catch (e) {
    return { error: `Cluster injoignable : ${(e as Error).message}` };
  }

  // 2) Correctness-critical unique indexes (also materializes the collections).
  for (const idx of UNIQUE_INDEXES) {
    await tenantPrisma.$runCommandRaw({
      createIndexes: idx.collection,
      indexes: [{ key: idx.key, name: idx.name, unique: true }],
    });
  }

  // 3) Default config (stages, field defs, starter sequence). Idempotent.
  await seedTenantConfig(tenantPrisma);

  // 4) Register tenant + admin login in the control plane.
  const tenant = await controlPrisma.tenant.create({
    data: {
      slug,
      name,
      connectionString: encrypt(connectionString),
      status: "ACTIVE",
    },
  });
  const passwordHash = await bcrypt.hash(args.adminPassword, 10);
  const user = await controlPrisma.user.upsert({
    where: { email: adminEmail },
    update: {}, // existing platform user keeps their password
    create: { email: adminEmail, name: `${name} admin`, passwordHash },
  });
  await controlPrisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: { role: "ADMIN" },
    create: { userId: user.id, tenantId: tenant.id, role: "ADMIN" },
  });

  // First entry of the new tenant's own audit trail.
  await logAudit(tenantPrisma, {
    userId: actorUserId,
    action: "TENANT_PROVISIONED",
    entity: "TENANT",
    entityId: tenant.id,
    details: `tenant "${slug}" provisionné, admin ${adminEmail}`,
  });

  return { ok: true, tenantId: tenant.id };
}

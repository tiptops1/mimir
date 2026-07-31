import bcrypt from "bcryptjs";
import { controlPrisma } from "@/lib/control-db";
import { encrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { seedTenantConfig } from "@/lib/default-config";
import { DEFAULT_MODULES } from "@/lib/modules";
import { logAudit } from "@/lib/audit";

/** Modules provisioning accepts. Keep in sync with TenantModule (src/lib/modules.ts). */
const KNOWN_MODULES = ["crm", "chronos"];

// Phase 4 self-serve onboarding: provision a new tenant from the running app —
// the server-action equivalent of scripts/provision-tenant.ts (which shells out
// to `prisma db push` and can't run inside a request). Mongo creates the DB and
// collections lazily; the uniqueness constraints the app's CORRECTNESS relies
// on are created explicitly below (Prisma db-push naming, so a later full
// `db push` per tenant is a no-op on them). The remaining perf-only indexes
// arrive with that later db push.

export const SLUG_RE = /^[a-z][a-z0-9_]{2,30}$/;

type UniqueIndex = {
  collection: string;
  name: string;
  key: Record<string, 1>;
};

/** Uniques every tenant needs, whatever it sells. */
const CORE_UNIQUE_INDEXES: UniqueIndex[] = [
  { collection: "FieldDefinition", name: "FieldDefinition_entity_key_key", key: { entity: 1, key: 1 } },
  // S31 made StageDefinition entity-scoped and folded UnitStageDefinition into
  // it, so BOTH verticals now share this collection — which is what moved it out
  // of the CRM list and up here. The old single-field `StageDefinition_key_key`
  // must never be recreated: it rejects a key legitimately shared by two
  // entities. scripts/migrate-stage-entity.ts drops it on existing tenants.
  { collection: "StageDefinition", name: "StageDefinition_entity_key_key", key: { entity: 1, key: 1 } },
  { collection: "Setting", name: "Setting_key_key", key: { key: 1 } },
  { collection: "SyncCursor", name: "SyncCursor_source_key", key: { source: 1 } },
];

/** Uniques the inherited CRM's logic depends on (dedupe keys, upsert targets). */
const CRM_UNIQUE_INDEXES: UniqueIndex[] = [
  { collection: "Company", name: "Company_siret_key", key: { siret: 1 } },
  { collection: "EmailSyncState", name: "EmailSyncState_mailbox_key", key: { mailbox: 1 } },
  { collection: "BlockedSender", name: "BlockedSender_value_key", key: { value: 1 } },
];

/** Uniques the Chronos inventory vertical's logic depends on (S27). */
const CHRONOS_UNIQUE_INDEXES: UniqueIndex[] = [
  // The load-bearing one: without it an S29 marketplace re-sync double-books
  // every fee line it already booked. See prisma/tenant/schema.prisma UnitCost.
  { collection: "UnitCost", name: "UnitCost_unitId_dedupeKey_key", key: { unitId: 1, dedupeKey: 1 } },
  { collection: "InventoryUnit", name: "InventoryUnit_sku_key", key: { sku: 1 } },
  { collection: "ProductRef", name: "ProductRef_brand_reference_variant_key", key: { brand: 1, reference: 1, variant: 1 } },
  // Must exist before seedTenantConfig runs (step 3 below) for the singleton
  // upsert to be race-safe.
  { collection: "ChronosConfig", name: "ChronosConfig_singleton_key", key: { singleton: 1 } },
  // S29: the marketplace sync upserts on this, so a re-sync over an overlapping
  // window updates the same order row instead of piling up duplicates.
  { collection: "MarketplaceOrder", name: "MarketplaceOrder_provider_externalId_key", key: { provider: 1, externalId: 1 } },
  // S30: the comp DB's idempotency. Without it a re-run of the Argus window
  // double-weights the same observation in the median, which silently biases
  // the band that S32's bid ceiling is derived from.
  { collection: "PricePoint", name: "PricePoint_refId_dedupeKey_key", key: { refId: 1, dedupeKey: 1 } },
  { collection: "RefPriceStat", name: "RefPriceStat_refId_kind_key", key: { refId: 1, kind: 1 } },
  // S32: one watch per reference, and one candidate row per marketplace
  // listing — the second is what stops a re-scan re-proposing a listing the
  // operator already ruled on.
  { collection: "SourcingWatch", name: "SourcingWatch_refId_key", key: { refId: 1 } },
  // S24 (Person/WorkLog) adds no unique of its own: a WorkLog's identity IS its
  // id, and the LABOUR cost line it books is keyed `work:<id>` under the
  // existing UnitCost unique above.
  { collection: "SourcingCandidate", name: "SourcingCandidate_provider_externalId_key", key: { provider: 1, externalId: 1 } },
];

/**
 * Uniques per module. A unique that exists in the Prisma schema but NOT here is
 * only created by a manual `db push` against that tenant — provisioning builds
 * these by hand, so correctness-critical dedupe keys must be listed. Names must
 * match Prisma's `<Model>_<field>…_key` convention exactly, or a later db push
 * creates a second duplicate index alongside.
 */
const MODULE_UNIQUE_INDEXES: Record<string, UniqueIndex[]> = {
  crm: CRM_UNIQUE_INDEXES,
  chronos: CHRONOS_UNIQUE_INDEXES,
};

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
  /** Verticals this tenant is entitled to. Defaults to the CRM. */
  modules?: string[];
  /** Product name for this tenant's shell. Falls back to the deployment brand. */
  brandName?: string;
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
  const modules = (args.modules?.length ? args.modules : DEFAULT_MODULES).map(
    (m) => m.trim(),
  );
  const brandName = args.brandName?.trim() || null;

  // homePathFor() assumes a tenant always has at least one module — a tenant
  // with none would have no reachable home page.
  if (modules.length === 0) return { error: "Au moins un module est requis." };
  const unknown = modules.filter((m) => !KNOWN_MODULES.includes(m));
  if (unknown.length > 0) {
    return { error: `Module inconnu : ${unknown.join(", ")}.` };
  }

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

  // 2) Correctness-critical unique indexes (also materializes the collections),
  //    scoped to what this tenant actually uses.
  const indexes = [
    ...CORE_UNIQUE_INDEXES,
    ...modules.flatMap((m) => MODULE_UNIQUE_INDEXES[m] ?? []),
  ];
  for (const idx of indexes) {
    await tenantPrisma.$runCommandRaw({
      createIndexes: idx.collection,
      indexes: [{ key: idx.key, name: idx.name, unique: true }],
    });
  }

  // 3) Default config for the entitled modules. Idempotent.
  await seedTenantConfig(tenantPrisma, { modules });

  // 4) Register tenant + admin login in the control plane.
  const tenant = await controlPrisma.tenant.create({
    data: {
      slug,
      name,
      brandName,
      modules,
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

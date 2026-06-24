// Per-tenant UI config (seed of the Phase-1 field-definition config store).
//
// Today the app is single-tenant: Christopher = tenant #1, and the constant below
// IS his config. The point of this seam is that nothing tenant-specific about how
// the pipeline card renders is hardcoded in components anymore — it's data.
//
// When the config store + `tenantId → connection` router land (Phase 0/1), change
// ONLY `getTenantConfig` to resolve the tenant's stored config from their DB.
// Every call site (pipeline board, cards) stays untouched.

/** A field a pipeline card can surface, mapped to data the page supplies per card. */
export type CardFieldKey = "contact" | "company" | "ville";

export interface PipelineCardConfig {
  /** Field shown as the bold card title. */
  titleField: CardFieldKey;
  /** Field shown on the subline under the title. */
  subtitleField: CardFieldKey;
  /** Tailwind text-color class for the subline. */
  subtitleClass: string;
}

/** The mailbox owner, surfaced in email-related copy (e.g. the inbox). */
export interface OwnerConfig {
  /** Display name of the mailbox owner, e.g. "Christopher". */
  name: string;
}

export interface TenantConfig {
  pipelineCard: PipelineCardConfig;
  owner: OwnerConfig;
}

/** Tenant #1 (Christopher): cards lead with the contact, company name beneath in light blue. */
const CHRISTOPHER_CONFIG: TenantConfig = {
  pipelineCard: {
    titleField: "contact",
    subtitleField: "company",
    subtitleClass: "text-sky-500",
  },
  owner: {
    name: "Christopher",
  },
};

/**
 * Resolve the active tenant's config.
 * Phase 0/1: take a `tenantId`, look the config up in the tenant DB. For now there
 * is one tenant, so this returns Christopher's seeded config.
 */
export function getTenantConfig(/* tenantId?: string */): TenantConfig {
  return CHRISTOPHER_CONFIG;
}

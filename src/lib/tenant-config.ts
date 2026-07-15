// Per-tenant UI config (seed of the Phase-1 field-definition config store).
//
// The constant below is the default seeded for every new tenant. The point of
// this seam is that nothing tenant-specific about how the pipeline card renders
// is hardcoded in components anymore — it's data.
//
// When the config store + `tenantId → connection` router land, change ONLY
// `getTenantConfig` to resolve the tenant's stored config from their DB. Every
// call site (pipeline board, cards) stays untouched.

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

/** Default seeded config: cards lead with the contact, company name beneath in light blue. */
const DEFAULT_CONFIG: TenantConfig = {
  pipelineCard: {
    titleField: "contact",
    subtitleField: "company",
    subtitleClass: "text-sky-500",
  },
  owner: {
    name: "Vous",
  },
};

/**
 * Resolve the active tenant's config.
 * Take a `tenantId`, look the config up in the tenant DB. For now every tenant
 * gets this same default (per-tenant override lands with the config store).
 */
export function getTenantConfig(/* tenantId?: string */): TenantConfig {
  return DEFAULT_CONFIG;
}

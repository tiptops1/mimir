import { CAPABILITY_METHODS, type MarketplaceConnector } from "./types";
import { demoConnector } from "./demo";
import { ebayConnector } from "./ebay";

const REGISTRY: Record<string, MarketplaceConnector> = {
  demo: demoConnector,
  // Registered at S29. Chrono24 / Vinted / LeBonCoin have no public API and
  // will never appear here — they stay CSV/manual, which
  // ChronosConfig.marketplaces records as `sync: "manual"` and the Chronos
  // import wizard (/chronos/import) serves.
  ebay: ebayConnector,
};

/** Providers this build can actually sync from, for the settings UI. */
export function isApiConnector(provider: string): boolean {
  return provider in REGISTRY;
}

export function getConnector(provider: string): MarketplaceConnector {
  const connector = REGISTRY[provider];
  if (!connector) throw new Error(`Unknown marketplace connector provider: ${provider}`);
  return connector;
}

export function listConnectors(): MarketplaceConnector[] {
  return Object.values(REGISTRY);
}

/**
 * Every declared capability must have its method, and every implemented method
 * must be declared. The capabilities object exists so the settings UI can say
 * "saisie manuelle" without instantiating behaviour — which only works if it
 * never lies. Asserted by connectors.test.ts across the whole registry.
 */
export function capabilityDrift(connector: MarketplaceConnector): string[] {
  const problems: string[] = [];
  for (const [capability, method] of Object.entries(CAPABILITY_METHODS)) {
    const declared = connector.capabilities[capability as keyof typeof CAPABILITY_METHODS];
    const implemented = typeof connector[method as keyof MarketplaceConnector] === "function";
    if (declared && !implemented) {
      problems.push(`${connector.provider}: declares ${capability} but has no ${method}()`);
    }
    if (!declared && implemented) {
      problems.push(`${connector.provider}: implements ${method}() but declares ${capability} false`);
    }
  }
  return problems;
}

export type { MarketplaceConnector };

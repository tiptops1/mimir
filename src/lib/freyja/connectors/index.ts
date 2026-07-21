import type { AdConnector } from "./types";
import { demoConnector } from "./demo";

const REGISTRY: Record<string, AdConnector> = {
  demo: demoConnector,
  // "google_ads" / "meta_ads" adapters register here once real API access
  // exists (dev token / app review) — see connectors/types.ts for the seam.
};

export function getConnector(provider: string): AdConnector {
  const connector = REGISTRY[provider];
  if (!connector) throw new Error(`Unknown ad connector provider: ${provider}`);
  return connector;
}

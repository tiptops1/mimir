import { isProd } from "./env-identity";

/**
 * The app's public base URL, for links that leave the process.
 *
 * Three call sites used to inline `process.env.APP_URL || "http://localhost:3000"`,
 * and all three build links that go into OUTBOUND EMAIL (the daily digest, the
 * outreach unsubscribe link, reply-sync footers). A missing APP_URL in production
 * therefore didn't fail — it mailed customers a link to their own laptop.
 *
 * So: localhost stays a convenience in dev, and is an error in prod.
 */
export function appUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (isProd()) {
    throw new Error(
      "APP_URL is not set. It is required when MIMIR_ENV=prod — outbound email " +
        "links (digest, unsubscribe) would otherwise point at http://localhost:3000.",
    );
  }
  return "http://localhost:3000";
}

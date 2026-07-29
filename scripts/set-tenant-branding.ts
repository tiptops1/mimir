import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";

/**
 * Set an EXISTING tenant's shell branding.
 *
 *   npm run tenant:branding -- --slug chronos_demo --brand "Chronos" \
 *     --logo /brands/chronos/logo.png
 *
 * `tenant:provision` takes --brand at creation time, and the self-serve form
 * sets it for new tenants, but nothing could change either value afterwards.
 * Pass --logo "" to clear the logo and fall back to the text wordmark.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("Usage: tenant:branding -- --slug <slug> [--brand <name>] [--logo <url>]");

  const brand = arg("brand");
  const logo = arg("logo");
  if (brand === undefined && logo === undefined) {
    throw new Error("Nothing to do: pass --brand and/or --logo");
  }

  const data: { brandName?: string | null; brandLogoUrl?: string | null } = {};
  if (brand !== undefined) data.brandName = brand.trim() || null;
  if (logo !== undefined) data.brandLogoUrl = logo.trim() || null;

  const control = new ControlClient();
  try {
    const tenant = await control.tenant.update({ where: { slug }, data });
    console.log(
      `✓ ${tenant.slug}: brandName=${tenant.brandName ?? "(default)"} ` +
        `brandLogoUrl=${tenant.brandLogoUrl ?? "(none)"}`,
    );
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

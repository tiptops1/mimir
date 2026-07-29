import { cn } from "@/lib/utils";
import { DEFAULT_BRAND_NAME, splitBrand } from "@/lib/brand";

export function BrandMark({
  className,
  showText = true,
  name = DEFAULT_BRAND_NAME,
  logoUrl = null,
}: {
  className?: string;
  showText?: boolean;
  /** Tenant's product name. Defaults to the deployment brand (pre-auth surfaces). */
  name?: string;
  /**
   * Tenant.brandLogoUrl — replaces the default glyph tile, not the wordmark.
   * Supplied art is typically a full-colour square that has to sit on both a
   * light and a dark shell; dropping it into the tile's exact box is the only
   * treatment that survives both themes. Null keeps the built-in mark.
   */
  logoUrl?: string | null;
}) {
  const { head, tail } = splitBrand(name);
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {logoUrl ? (
        // Plain <img>: brandLogoUrl may be an absolute URL, which next/image
        // would require images.remotePatterns config for. The asset is a
        // build-time-optimised 256px square (scripts/chronos/build-brand-assets.mjs).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-inset ring-white/15"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-on-brand shadow-sm ring-1 ring-inset ring-white/15">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-[18px] w-[18px]"
            aria-hidden="true"
          >
            <path
              d="M4 19V11m5 8V6m5 13v-9m5 9V8"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
      {showText ? (
        <div className="leading-none">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            {head}
            <span className="text-brand">{tail}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

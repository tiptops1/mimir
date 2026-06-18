import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            d="M4 19V9m5 10V5m5 14v-7m5 7V8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {showText ? (
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Avelior</p>
          <p className="-mt-0.5 text-[11px] font-medium text-muted">
            Analytics
          </p>
        </div>
      ) : null}
    </div>
  );
}

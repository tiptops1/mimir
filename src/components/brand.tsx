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
      {showText ? (
        <div className="leading-none">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Mi<span className="text-brand">mir</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

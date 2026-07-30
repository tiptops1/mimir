import { ViewTransition } from "react";

export function PageHeader({
  title,
  subtitle,
  titleTransitionName,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shared-element morph name (e.g. `company-${id}`) matching a list row's identity element. */
  titleTransitionName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card px-4 py-5 sm:px-6">
      {/* Realm atmosphere (C4). Purely decorative; the header's content sits
          above it via `relative` — an absolute sibling would otherwise paint
          over static in-flow text.
          The clip lives on this wrapper, NOT on the header: the header's action
          slot hosts EnumCell's `top-full` dropdown (companies/[id],
          chronos/[id]), which an overflow-hidden header would cut off. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="realm-aura" />
      </div>
      <div className="relative min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {titleTransitionName ? (
            <ViewTransition name={titleTransitionName}>{title}</ViewTransition>
          ) : (
            title
          )}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        ) : null}
      </div>
      {children ? (
        <div className="relative flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

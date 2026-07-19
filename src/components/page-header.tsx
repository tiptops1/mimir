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
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card px-4 py-5 sm:px-6">
      <div className="min-w-0">
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
        <div className="flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

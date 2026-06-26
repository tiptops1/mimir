import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-5 py-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[13px] font-semibold tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted ring-1 ring-inset ring-border",
  brand: "bg-brand-subtle text-brand ring-1 ring-inset ring-brand/15",
  success: "bg-success-subtle text-success ring-1 ring-inset ring-success/15",
  warning: "bg-warning-subtle text-warning ring-1 ring-inset ring-warning/15",
  danger: "bg-danger-subtle text-danger ring-1 ring-inset ring-danger/15",
  info: "bg-info-subtle text-info ring-1 ring-inset ring-info/15",
};

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        // `tone` is opt-in; when omitted callers still pass explicit color
        // classes (existing badges.tsx / stage-meta usage), so don't force one.
        tone && badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,box-shadow,border-color,transform,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-on-brand shadow-xs hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "bg-card text-foreground border border-border shadow-xs hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-foreground hover:bg-surface-2",
  danger: "bg-danger text-white shadow-xs hover:brightness-95",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        buttonBase,
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link
      className={cn(
        buttonBase,
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

const fieldBase =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-xs font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

"use client";

import { cn } from "@/shared/utils/cn";

// Spinner loading
export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-brand-500",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

// Full page loading
export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg">
      <Spinner size="xl" />
      <p className="mt-4 text-text-muted">{message}</p>
    </div>
  );
}

// Centered busy overlay for long operations (e.g. backup export/import).
// Renders above modals with a dark blurred backdrop, a large spinner
// centered on screen, an optional message, and an optional progress bar.
// Pass fixed={false} to render as an absolute fill inside a relative
// parent (e.g. inside a modal) instead of a fullscreen fixed overlay.
export function CenterLoading({ message, progress = null, fixed = true, className }) {
  const pct =
    typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center bg-black/55 backdrop-blur-[3px]",
        fixed ? "fixed inset-0 z-[70]" : "absolute inset-0 z-10 rounded-[10px]",
        className
      )}
    >
      <div className="flex flex-col items-center justify-center px-6 text-center">
        <Spinner size="xl" />
        {message ? (
          <p className="mt-4 text-sm font-medium text-white">{message}</p>
        ) : null}
        {pct !== null ? (
          <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const BusyOverlay = CenterLoading;

// Skeleton loading
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

// Card skeleton
export function CardSkeleton() {
  return (
    <div className="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-[10px]" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}

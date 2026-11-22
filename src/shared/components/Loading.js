"use client";

import { cn } from "@/shared/utils/cn";

// Loading surfaces that stay inside their own container: a four-box indicator, a full-page
// block, or a skeleton. Long-running work does NOT live here - it reports through the task
// store into the notification bell (`taskStore` -> `NotifToast`). The floating banner and its
// wrappers are gone: a fixed overlay rendered nothing, and the inline variant covered the form.

// Four-box loading indicator. Each square takes its turn to make progress visible without a ring.
export function Spinner({ size = "md", className, decorative = false }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "loading-boxes text-brand-500",
        sizes[size],
        className
      )}
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : "Loading"}
      aria-hidden={decorative ? "true" : undefined}
    >
      {Array.from({ length: 4 }, (_, index) => (
        <span key={index} className="loading-boxes__square" aria-hidden="true" />
      ))}
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

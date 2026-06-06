"use client";

import Link from "next/link";
import { Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/**
 * Consistent empty state with optional primary action.
 */
export default function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  borderless = false,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-10 text-center",
        !borderless && "rounded-xl border border-dashed border-border bg-surface/50",
        className,
      )}
    >
      <span className="material-symbols-outlined text-[32px] text-text-muted mb-3">{icon}</span>
      <h3 className="text-sm font-semibold text-text-main">{title}</h3>
      {description ? <p className="text-xs text-text-muted mt-1 max-w-sm">{description}</p> : null}
      {action ? (
        <div className="mt-4">
          {action.href ? (
            <Link href={action.href}>
              <Button variant="primary" size="sm">{action.label}</Button>
            </Link>
          ) : (
            <Button variant="primary" size="sm" onClick={action.onClick}>{action.label}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

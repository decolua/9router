"use client";

import { cn } from "@/shared/utils/cn";

/**
 * Fixed bottom action bar for primary page actions on mobile.
 * Hidden at lg+ where inline toolbars are used instead.
 */
export default function MobileStickyActionBar({ children, className }) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface/95 backdrop-blur-xl p-3 lg:hidden",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </div>
  );
}

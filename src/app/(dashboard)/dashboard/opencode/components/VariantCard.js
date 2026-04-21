"use client";

import { Badge } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

export default function VariantCard({
  title,
  description,
  selected = false,
  onClick,
  badges = [],
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-4 text-left transition-all",
        "focus:outline-none focus:ring-1 focus:ring-primary/30",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-black/5 hover:border-primary/40 hover:bg-black/[0.01] dark:border-white/5 dark:hover:bg-white/[0.02]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-text-main">{title}</div>
          <div className="text-sm text-text-muted">{description}</div>
        </div>
        {selected ? <Badge variant="primary">Selected</Badge> : null}
      </div>

      {badges.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <Badge key={badge} size="sm">
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
    </button>
  );
}

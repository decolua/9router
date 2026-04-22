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
        "group relative overflow-hidden rounded-[24px] border px-5 py-[1.125rem] text-left transition-all duration-200",
        "focus:outline-none focus:ring-1 focus:ring-primary/30",
        selected
          ? "border-primary/40 bg-gradient-to-br from-primary/[0.11] via-primary/[0.05] to-transparent shadow-[0_18px_40px_rgba(0,0,0,0.06)]"
          : "border-black/5 bg-white/[0.74] hover:-translate-y-0.5 hover:border-primary/40 hover:bg-black/[0.01] hover:shadow-[0_14px_34px_rgba(0,0,0,0.05)] dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-white/[0.03]"
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 pr-2">
          <div className="text-[15px] font-semibold leading-6 text-text-main sm:text-base">{title}</div>
          <div className="text-sm leading-6 text-text-muted">{description}</div>
        </div>
        <div className="flex flex-col items-end gap-2.5 pt-0.5">
          {selected ? <Badge variant="primary">Selected</Badge> : null}
          <span className={cn(
            "material-symbols-outlined text-[18px] transition-transform duration-200",
            selected ? "text-primary" : "text-text-muted group-hover:translate-x-0.5 group-hover:text-text-main"
          )}>
            arrow_outward
          </span>
        </div>
      </div>

      {badges.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
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

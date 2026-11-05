"use client";

import Link from "next/link";
import Image from "next/image";
import { cn } from "@/shared/utils/cn";

// Derive simple connected/configured/not-installed status from API payload
function getStatus(status, tool) {
  if (tool?.configType === "guide") return { label: "Guide", dot: "bg-info", cls: "bg-info/10 text-info border-info/20" };
  if (!status) return { label: "Unknown", dot: "bg-text-muted/50", cls: "bg-surface-3 text-text-muted border-border-subtle" };
  if (!status.installed) return { label: "Not installed", dot: "bg-text-muted/50", cls: "bg-surface-3 text-text-muted border-border-subtle" };
  if (status.has9Router) return { label: "Connected", dot: "bg-success", cls: "bg-success/10 text-success border-success/20" };
  return { label: "Not configured", dot: "bg-warning", cls: "bg-warning/10 text-warning border-warning/20" };
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const s = getStatus(status, tool);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block group">
      <div className={cn(
        "relative h-full overflow-hidden rounded-[var(--r-card)]",
        "bg-surface border border-border-subtle shadow-[var(--elev-1)]",
        "p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-[var(--elev-2)]",
        "chrome-interactive"
      )}>
        <div className="flex items-start gap-3">
          <div
            className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl"
          >
            {tool.image ? (
              <Image src={tool.image} alt={tool.name} width={44} height={44} className="size-full object-cover" sizes="44px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
            ) : tool.icon ? (
              <span className="material-symbols-outlined text-[24px]" style={{ color: tool.color }}>{tool.icon}</span>
            ) : (
              <span className="material-symbols-outlined text-[24px] text-text-muted">terminal</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-text-main">{tool.name}</h3>
            {tool.description && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">{tool.description}</p>
            )}
          </div>
          <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">chevron_right</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium", s.cls)}>
            <span className={cn("size-1.5 rounded-full", s.dot)} />
            {s.label}
          </span>
          <span className="text-[10px] text-text-muted">Setup →</span>
        </div>
      </div>
    </Link>
  );
}
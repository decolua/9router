"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "./Tooltip";
import { IconEye, IconBrain } from "./SvgIcons";

// capacity keys -> SVG component + colors
const CAP_ICONS = {
  vision: IconEye,
  reasoning: IconBrain,
};

const CAP_COLORS = {
  vision: "text-blue-500",
  reasoning: "text-violet-500",
};

export default function CapacityBadges({ caps, className = "", colorOverride, size = 16 }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {active.map((k) => {
        const meta = CAPACITY_META[k];
        const Icon = CAP_ICONS[k];
        const color = colorOverride || CAP_COLORS[k] || meta.color;
        return (
          <Tooltip key={k} text={`${meta.label} — ${meta.desc}`}>
            <span className={`inline-flex items-center justify-center rounded-full bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 p-0.5 cursor-help ${color}`}>
              {Icon ? <Icon size={size} className={color} /> : <span className="text-[10px] leading-none">{meta.label[0]}</span>}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

// Standalone badge for vision / reasoning with label
export function VisionBadge({ size = 14 }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900">
      <IconEye size={size} /> Vision
    </span>
  );
}

export function ReasoningBadge({ mode = "auto", size = 14 }) {
  const labels = { auto: "Auto", low: "Low", medium: "Med", high: "High", extra: "Extra", on: "On", off: "Off", none: "Off" };
  const colors = {
    auto: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    low: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    medium: "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    high: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    extra: "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    on: "border-violet-200 bg-violet-50 text-violet-700",
    off: "border-zinc-200 bg-zinc-50 text-zinc-500",
    none: "border-zinc-200 bg-zinc-50 text-zinc-500",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colors[mode] || colors.auto}`}>
      <IconBrain size={size} /> {labels[mode] || mode}
    </span>
  );
}

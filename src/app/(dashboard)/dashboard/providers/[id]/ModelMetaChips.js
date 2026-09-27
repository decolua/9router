"use client";

import PropTypes from "prop-types";
import { Tooltip } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatContextLength } from "@/shared/utils/importProviderModels";

// *Source ("provider" | "tested" | "catalog" | "estimated") tells where a
// measured fact came from — see src/app/api/models/route.js withMeasuredFacts.
// A caps object built by the client-side fallback in useModelCaps carries no
// *Source field at all; that case reads the same as "estimated".
function sourceLabel(source) {
  switch (source) {
    case "provider": return translate("Reported by the provider");
    case "tested": return translate("Detected by test");
    case "catalog": return translate("From the model catalog");
    default: return translate("Estimated from the model name");
  }
}

// Small pills next to a model's name: its measured context window and whether
// it reasons on this provider, each with a tooltip naming the source. Caller
// is responsible for not also rendering the reasoning capability badge
// elsewhere on the same row (see CapacityBadges usage in ModelRow).
// One shape for every chip on a model row (context, reasoning, combos) so
// they line up.
export const MODEL_CHIP_CLASS = "inline-flex h-[18px] items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium leading-none";

// Small pills next to a model's name: its measured context window and whether
// it reasons on this provider, each with a tooltip naming the source. Caller
// is responsible for not also rendering the reasoning capability badge
// elsewhere on the same row (see CapacityBadges usage in ModelRow).
export default function ModelMetaChips({ caps, className = "" }) {
  if (!caps) return null;
  const contextLabel = formatContextLength(caps.contextWindow);
  const contextSource = caps.contextSource || "estimated";
  const showReasoning = caps.reasoning === true;
  const reasoningSource = caps.reasoningSource || "estimated";
  const estimated = contextSource === "estimated";

  if (!contextLabel && !showReasoning) return null;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {contextLabel && (
        <Tooltip text={`${translate("Context window")}: ${Number(caps.contextWindow).toLocaleString()} tokens · ${sourceLabel(contextSource)}`}>
          <span
            className={`${MODEL_CHIP_CLASS} cursor-help font-mono tabular-nums ${
              estimated
                ? "border-dashed border-border text-text-muted/60"
                : "border-border bg-black/[0.03] text-text-muted dark:bg-white/[0.04]"
            }`}
          >
            <span className="material-symbols-outlined text-[12px]">memory</span>
            {estimated ? `~${contextLabel}` : contextLabel}
          </span>
        </Tooltip>
      )}
      {showReasoning && (
        <Tooltip text={`${translate("Reasoning")} · ${sourceLabel(reasoningSource)}`}>
          <span className={`${MODEL_CHIP_CLASS} cursor-help border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`}>
            <span className="material-symbols-outlined text-[12px]">neurology</span>
            {translate("Reasoning")}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

ModelMetaChips.propTypes = {
  caps: PropTypes.shape({
    contextWindow: PropTypes.number,
    contextSource: PropTypes.string,
    reasoning: PropTypes.bool,
    reasoningSource: PropTypes.string,
  }),
  className: PropTypes.string,
};

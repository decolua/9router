"use client";

import { parseModelReference } from "open-sse/utils/modelReference.js";
import SegmentedControl from "./SegmentedControl";
import Tooltip from "./Tooltip";

export default function ComboModelControl({ comboName, isSmart, model, policyLabel, routerStatus, onSelectAuto, onConfigure }) {
  const modelLabel = parseModelReference(model).model;
  const summary = isSmart
    ? routerStatus?.ready ? [modelLabel, policyLabel].filter(Boolean).join(" · ") : "Router account needs configuration."
    : modelLabel || "First combo member is the judge.";
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-black/[0.015] p-3 dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-text-main">
          {isSmart ? "Router & policy" : "Judge model"}
          {routerStatus && <span role="img" aria-label={`Router: ${routerStatus.label}`} title={routerStatus.label} className={`size-1.5 shrink-0 rounded-full ${routerStatus.ready ? "bg-emerald-500" : "bg-amber-500"}`} />}
        </span>
        <Tooltip text={isSmart ? "Auto uses the default System One router. Custom lets you choose a model and account. Configure its conversation policy below." : "Auto uses the first combo member to combine the panel answers. Custom lets you choose a judge model and account."}>
          <button type="button" aria-label={`About ${isSmart ? "router settings" : "judge model"} for ${comboName}`} className="flex size-5 items-center justify-center rounded text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">info</span></button>
        </Tooltip>
      </div>
      <SegmentedControl variant="panel" ariaLabel={`${isSmart ? "Router" : "Judge"} selection for ${comboName}`} value={model ? "custom" : "auto"}
        onChange={value => value === "auto" ? onSelectAuto() : onConfigure()}
        options={[{ value: "auto", label: "Auto", icon: "auto_mode", ariaLabel: `Use automatic ${isSmart ? "router" : "judge"} for ${comboName}` }, { value: "custom", label: "Custom", icon: "tune", ariaLabel: `Choose custom ${isSmart ? "router" : "judge"} for ${comboName}` }]} />
      <button type="button" onClick={onConfigure} aria-label={`Configure ${isSmart ? "Smart Router" : "Fusion"} for ${comboName}`} title={summary}
        className={`mt-2 flex w-full min-w-0 items-start justify-between gap-2 rounded text-left text-[11px] leading-relaxed hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${routerStatus && !routerStatus.ready ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}`}>
        <span className="min-w-0 truncate">{summary}</span><span className="shrink-0 font-medium text-primary">Configure</span>
      </button>
    </div>
  );
}

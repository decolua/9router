"use client";

import Tooltip from "./Tooltip";
import SegmentedControl from "./SegmentedControl";

export default function SessionAffinityControl({ enabled, onChange, comboName }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-black/[0.015] p-3 dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-main">Session affinity</span>
        <Tooltip text="Sticky sessions retain the successful model and actual account for two hours after the last use. Round-robin distributes new conversations; fallback follows member order. Failed accounts follow the account fallback setting.">
          <button type="button" aria-label={`About session affinity for ${comboName}`} className="flex size-5 items-center justify-center rounded text-text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px]">info</span>
          </button>
        </Tooltip>
      </div>
      <SegmentedControl variant="panel" ariaLabel={`Session affinity for ${comboName}`} value={enabled} onChange={onChange}
        options={[{ value: false, label: "Per turn", icon: "sync" }, { value: true, label: "Sticky", icon: "lock" }]} />
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{enabled ? "Keep each conversation on its successful account." : "Choose a combo member on each request."}</p>
    </div>
  );
}

"use client";

import { ACCOUNT_FALLBACK_MODES, normalizeAccountFallbackMode } from "open-sse/config/accountRouting.js";
import Tooltip from "./Tooltip";
import Select from "./Select";

export default function AccountFallbackControl({ value, onChange, comboName }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-black/[0.015] p-3 dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-main">Account fallback</span>
        <Tooltip text="Selected account only: a pinned member uses its assigned account; failure moves to the next combo member. Prefer selected account: another permitted account of the same provider may answer. Auto members keep normal account selection.">
          <button type="button" aria-label={`About account fallback for ${comboName}`} className="flex size-5 items-center justify-center rounded text-text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px]">info</span>
          </button>
        </Tooltip>
      </div>
      <Select
        aria-label={`Account fallback for ${comboName}`}
        value={normalizeAccountFallbackMode(value)}
        onChange={event => onChange(event.target.value)}
        selectClassName="min-h-10 py-2! text-xs! border-border/60! bg-surface!"
        options={[{ value: ACCOUNT_FALLBACK_MODES.STRICT, label: "Selected account only" }, { value: ACCOUNT_FALLBACK_MODES.PREFER, label: "Prefer selected account" }]}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{value === ACCOUNT_FALLBACK_MODES.PREFER ? "Allow another account when the selected one fails." : "Use the account assigned to each model."}</p>
    </div>
  );
}

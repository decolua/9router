"use client";

import { ACCOUNT_FALLBACK_MODES, normalizeAccountFallbackMode } from "open-sse/config/accountRouting.js";
import { useTranslation } from "@/i18n/useTranslation";
import Tooltip from "./Tooltip";
import Select from "./Select";

export default function AccountFallbackControl({ value, onChange, comboName }) {
  const t = useTranslation();
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-black/[0.015] p-3 dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-main">{t("Account fallback")}</span>
        <Tooltip text={t("Selected account only: a pinned member uses its assigned account; failure moves to the next combo member. Prefer selected account: another permitted account of the same provider may answer. Auto members keep normal account selection.")}>
          <button type="button" aria-label={`${t("About account fallback")}: ${comboName}`} className="flex size-5 items-center justify-center rounded text-text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px]">info</span>
          </button>
        </Tooltip>
      </div>
      <Select
        aria-label={`${t("Account fallback")}: ${comboName}`}
        value={normalizeAccountFallbackMode(value)}
        onChange={event => onChange(event.target.value)}
        selectClassName="min-h-10 py-2! text-xs! border-border/60! bg-surface!"
        options={[{ value: ACCOUNT_FALLBACK_MODES.STRICT, label: t("Selected account only") }, { value: ACCOUNT_FALLBACK_MODES.PREFER, label: t("Prefer selected account") }]}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{value === ACCOUNT_FALLBACK_MODES.PREFER ? t("Allow another account when the selected one fails.") : t("Use the account assigned to each model.")}</p>
    </div>
  );
}

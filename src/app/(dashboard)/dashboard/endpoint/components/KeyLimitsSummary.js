"use client";

// One-line limits summary on an API key card: a chip per set budget plus
// expiry. Read-only; editing lives in the Budgets & expiry modal.
import PropTypes from "prop-types";
import { keyBudgets, isKeyExpired } from "@/shared/utils/keyQuota.js";
import { fmtUsd, budgetStatus } from "./KeyBudgetMeters";

const chip = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 tabular-nums";

export default function KeyLimitsSummary({ apiKey }) {
  const budgets = keyBudgets(apiKey);
  const expired = isKeyExpired(apiKey);
  if (!budgets.length && !apiKey.expiresAt) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]" data-testid="key-limits">
      {budgets.map(({ id, short, label, limit }) => {
        const spent = apiKey.spend?.[id]?.spent || 0;
        const s = budgetStatus((spent / limit) * 100);
        const end = apiKey.spend?.[id]?.end;
        return (
          <span
            key={id}
            className={`${chip} ${s.icon ? `border-current ${s.text}` : "border-border text-text-muted"}`}
            title={`${label} budget${s.label ? ` — ${s.label}` : ""}${end ? ` · resets ${new Date(end).toLocaleString()}` : ""}`}
          >
            {s.icon && <span className="material-symbols-outlined text-[12px]">{s.icon}</span>}
            {short} <span className={s.icon ? "" : "text-text-main"}>{fmtUsd(spent)}</span>/{fmtUsd(limit)}
          </span>
        );
      })}
      {apiKey.expiresAt && (
        <span
          className={`${chip} ${expired ? "border-current text-red-500" : "border-border text-text-muted"}`}
          title={new Date(apiKey.expiresAt).toLocaleString()}
        >
          <span className="material-symbols-outlined text-[12px]">{expired ? "event_busy" : "event"}</span>
          {expired ? "Expired" : "Expires"} {new Date(apiKey.expiresAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

KeyLimitsSummary.propTypes = {
  apiKey: PropTypes.shape({ expiresAt: PropTypes.string, spend: PropTypes.object }).isRequired,
};

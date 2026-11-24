"use client";

// Progress meters for a key's daily / weekly / monthly budgets.
// State is shown as text + icon, never color alone.
import PropTypes from "prop-types";
import { keyBudgets } from "@/shared/utils/keyQuota.js";

export const fmtUsd = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;

export function budgetStatus(pct) {
  if (pct >= 100) return { bar: "bg-red-500", text: "text-red-500", icon: "block", label: "Blocked" };
  if (pct >= 80) return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", icon: "warning", label: "Near limit" };
  return { bar: "bg-primary", text: "", icon: null, label: null };
}

export default function KeyBudgetMeters({ apiKey, spend }) {
  const budgets = keyBudgets(apiKey);
  if (!budgets.length) return null;

  return (
    <div className="grid gap-3">
      {budgets.map(({ id, label, limit }) => {
        const spent = spend?.[id]?.spent || 0;
        const pct = Math.min(100, (spent / limit) * 100);
        const s = budgetStatus((spent / limit) * 100);
        const resets = spend?.[id]?.end ? new Date(spend[id].end).toLocaleString() : null;
        return (
          <div key={id} title={resets ? `Resets ${resets}` : undefined}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-text-main">{label}</span>
              <span className={`flex items-center gap-1 tabular-nums ${s.text}`}>
                {s.icon && <span className="material-symbols-outlined text-[14px]">{s.icon}</span>}
                {s.label && <span>{s.label} ·</span>}
                <span className="text-text-main">{fmtUsd(spent)}</span>
                <span className="text-text-muted">/ {fmtUsd(limit)}</span>
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
              role="progressbar"
              aria-label={`${label} budget`}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Number(spent.toFixed(4))}
            >
              <div className={`h-full rounded-full transition-all ${s.bar}`} style={{ width: `${pct}%` }} />
            </div>
            {resets && <p className="mt-1 text-[11px] text-text-muted">Resets {resets}</p>}
          </div>
        );
      })}
    </div>
  );
}

KeyBudgetMeters.propTypes = {
  apiKey: PropTypes.object.isRequired,
  spend: PropTypes.object,
};

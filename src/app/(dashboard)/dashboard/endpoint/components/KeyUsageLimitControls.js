"use client";

// Per-API-key usage limits on the Endpoint page.
// "Usage limits" toggle per key; when on, one row per period (daily/weekly/monthly)
// with optional cost / total / input / output token caps. Empty field = no limit.
// Shows current-period usage against each cap; the /v1 gate returns 429 once any cap is hit.
import { useState } from "react";
import PropTypes from "prop-types";
import { Toggle, Button } from "@/shared/components";
import {
  KEY_USAGE_PERIODS,
  KEY_USAGE_PERIOD_LABELS,
  KEY_USAGE_METRICS,
  KEY_USAGE_METRIC_LABELS,
} from "@/shared/constants/keyUsageLimit.js";
import { getMetricValue } from "@/shared/utils/keyUsageLimit.js";

const COST_FRACTION_DIGITS = 4;
const WARN_RATIO = 0.8;

function limitsToDraft(limits) {
  const draft = {};
  for (const period of KEY_USAGE_PERIODS) {
    draft[period] = {};
    for (const metric of KEY_USAGE_METRICS) {
      const v = limits?.[period]?.[metric];
      draft[period][metric] = v === undefined ? "" : String(v);
    }
  }
  return draft;
}

// Returns { limits } or { error } — never silently drops a malformed field.
function draftToLimits(draft) {
  const limits = {};
  for (const period of KEY_USAGE_PERIODS) {
    const rule = {};
    for (const metric of KEY_USAGE_METRICS) {
      const raw = String(draft[period][metric] ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return { error: `${KEY_USAGE_PERIOD_LABELS[period]} ${KEY_USAGE_METRIC_LABELS[metric]}: invalid number` };
      }
      rule[metric] = metric === "maxCost" ? n : Math.floor(n);
    }
    if (Object.keys(rule).length) limits[period] = rule;
  }
  return { limits };
}

function formatValue(metric, value) {
  if (metric === "maxCost") return `$${value.toFixed(COST_FRACTION_DIGITS)}`;
  return Math.round(value).toLocaleString();
}

function usageColorClass(used, max) {
  if (used >= max) return "text-red-500";
  if (used >= max * WARN_RATIO) return "text-orange-500";
  return "text-text-muted";
}

export default function KeyUsageLimitControls({ apiKey, onSave }) {
  const limits = apiKey.usageLimits || {};
  const hasLimits = Object.keys(limits).length > 0;
  const [enabled, setEnabled] = useState(hasLimits);
  const [draft, setDraft] = useState(() => limitsToDraft(limits));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (nextLimits) => {
    setSaving(true);
    setError("");
    const err = await onSave(nextLimits);
    if (err) setError(err);
    setSaving(false);
  };

  const handleToggle = (checked) => {
    setEnabled(checked);
    if (!checked && hasLimits) save(null);
  };

  const handleSave = () => {
    const { limits: next, error: parseError } = draftToLimits(draft);
    if (parseError) { setError(parseError); return; }
    save(next);
  };

  const setField = (period, metric, value) => {
    setDraft((prev) => ({ ...prev, [period]: { ...prev[period], [metric]: value } }));
  };

  return (
    <div className="mt-2" data-testid="key-usage-limits">
      <Toggle size="sm" checked={enabled} label="Usage limits" onChange={handleToggle} />
      {enabled && (
        <div className="mt-2 flex flex-col gap-2">
          {KEY_USAGE_PERIODS.map((period) => {
            const usage = apiKey.usage?.[period];
            const rule = limits[period];
            return (
              <div key={period} className="rounded-lg border border-black/5 dark:border-white/5 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{KEY_USAGE_PERIOD_LABELS[period]}</span>
                  {usage?.resetAt && (
                    <span className="text-[11px] text-text-muted">Resets {new Date(usage.resetAt).toLocaleString()}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {KEY_USAGE_METRICS.map((metric) => {
                    const max = rule?.[metric];
                    const used = usage ? getMetricValue(metric, usage) : 0;
                    return (
                      <label key={metric} className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-text-muted">{KEY_USAGE_METRIC_LABELS[metric]}</span>
                        <input
                          type="number"
                          min="0"
                          step={metric === "maxCost" ? "0.01" : "1"}
                          placeholder="No limit"
                          value={draft[period][metric]}
                          onChange={(e) => setField(period, metric, e.target.value)}
                          className="w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-xs focus:outline-none focus:border-primary"
                        />
                        {max !== undefined && usage && (
                          <span className={`text-[11px] ${usageColorClass(used, max)}`}>
                            {formatValue(metric, used)} / {formatValue(metric, max)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save limits"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

KeyUsageLimitControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    usageLimits: PropTypes.object,
    usage: PropTypes.object,
  }).isRequired,
  onSave: PropTypes.func.isRequired,
};

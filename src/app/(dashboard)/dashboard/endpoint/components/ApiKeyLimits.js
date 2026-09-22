"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal } from "@/shared/components";

export const formatNumber = (n) => Math.round(n || 0).toLocaleString("en-US");
export const formatUsd = (n) => `$${(n || 0).toFixed(2)}`;

export function barColor(ratio) {
  if (ratio >= 1) return "bg-red-500";
  if (ratio >= 0.8) return "bg-orange-500";
  return "bg-primary";
}

function UsageMeter({ label, used, limit, format }) {
  const ratio = limit ? Math.min(used / limit, 1) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-text-muted">
        <span>{label}</span>
        <span className={`font-mono ${limit && used >= limit ? "text-red-500" : ""}`}>
          {format(used)}{limit ? ` / ${format(limit)}` : " · no limit"}
        </span>
      </div>
      {limit ? (
        <div className="h-1 mt-1 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div className={`h-full rounded-full ${barColor(used / limit)}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

UsageMeter.propTypes = {
  label: PropTypes.string.isRequired,
  used: PropTypes.number,
  limit: PropTypes.number,
  format: PropTypes.func.isRequired,
};

export function KeyUsageSummary({ usage }) {
  if (!usage) return null;
  const shown = usage.limits.filter((l) => l.always || l.limit);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-2 max-w-xl">
      <UsageMeter label="Requests/min" used={usage.rpm.used} limit={usage.rpm.limit} format={formatNumber} />
      {shown.map((l) => (
        <UsageMeter key={l.field} label={l.label} used={l.used} limit={l.limit} format={l.money ? formatUsd : formatNumber} />
      ))}
    </div>
  );
}

KeyUsageSummary.propTypes = {
  usage: PropTypes.shape({
    rpm: PropTypes.object,
    limits: PropTypes.arrayOf(PropTypes.object),
  }),
};

// Form layout. Field names must match API_KEY_LIMIT_FIELDS in apiKeysRepo.js
const LIMIT_SECTIONS = [
  {
    title: "Rate",
    fields: [{ name: "rpmLimit", label: "Requests / minute" }],
  },
  {
    title: "Per day",
    hint: "Resets at the server's local midnight.",
    fields: [
      { name: "dailyTokenLimit", label: "Total tokens" },
      { name: "dailyInputTokenLimit", label: "Input tokens" },
      { name: "dailyOutputTokenLimit", label: "Output tokens" },
    ],
  },
  {
    title: "Per month",
    hint: "Resets on the 1st. Budget uses the cost estimates from Pricing settings.",
    fields: [
      { name: "monthlyTokenLimit", label: "Total tokens" },
      { name: "monthlyInputTokenLimit", label: "Input tokens" },
      { name: "monthlyOutputTokenLimit", label: "Output tokens" },
      { name: "monthlyRequestLimit", label: "Requests" },
      { name: "monthlyBudget", label: "Budget (USD)", step: "0.01" },
    ],
  },
];
const ALL_FIELDS = LIMIT_SECTIONS.flatMap((s) => s.fields);

const toField = (v) => (v === null || v === undefined ? "" : String(v));
const toLimit = (v) => (String(v).trim() === "" ? null : Number(v));

export function KeyLimitsModal({ apiKey, onClose, onSave }) {
  // Mounted fresh per key (parent passes key={id}), so props seed the form once
  const [values, setValues] = useState(() =>
    Object.fromEntries(ALL_FIELDS.map((f) => [f.name, toField(apiKey?.[f.name])]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const invalid = Object.values(values).some((v) => String(v).trim() !== "" && !(Number(v) >= 0));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(apiKey.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, toLimit(v)])));
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save limits");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!apiKey} size="xl" title={`Limits — ${apiKey?.name || ""}`} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <p className="text-xs text-text-muted">
          Leave empty (or 0) for no limit. Requests over any limit get HTTP 429 with a Retry-After header.
          Token limits are checked before each request, so in-flight requests can go slightly over.
        </p>
        {LIMIT_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium text-text-main">{section.title}</p>
              {section.hint && <p className="text-xs text-text-muted">{section.hint}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {section.fields.map((f) => (
                <Input
                  key={f.name}
                  label={f.label}
                  type="number"
                  min="0"
                  step={f.step}
                  value={values[f.name]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  placeholder="Unlimited"
                />
              ))}
            </div>
          </div>
        ))}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={saving || invalid}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

KeyLimitsModal.propTypes = {
  apiKey: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
};

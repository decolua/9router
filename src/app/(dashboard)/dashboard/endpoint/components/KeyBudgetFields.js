"use client";

// Expiry + daily / weekly / monthly USD budget inputs for an API key.
// Shared by the Create API Key modal and the Edit limits modal.
import PropTypes from "prop-types";
import { Input } from "@/shared/components";
import { KEY_QUOTA_PERIODS } from "@/shared/utils/keyQuota.js";

// ISO -> value for <input type="datetime-local"> (local time, minute precision).
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Form state from a key record (or empty for a new key). */
export function budgetFormFromKey(key = {}) {
  const form = { expiresAt: toLocalInput(key.expiresAt) };
  for (const { field } of KEY_QUOTA_PERIODS) form[field] = key[field] ?? "";
  return form;
}

/** Form state -> API payload (empty = no limit). */
export function budgetPayloadFromForm(form) {
  const payload = { expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null };
  for (const { field } of KEY_QUOTA_PERIODS) payload[field] = form[field] === "" ? null : Number(form[field]);
  return payload;
}

/** Error message for the first invalid budget, or null. */
export function budgetFormError(form) {
  for (const { field, label } of KEY_QUOTA_PERIODS) {
    if (form[field] !== "" && !(Number(form[field]) > 0)) return `${label} budget must be greater than 0`;
  }
  return null;
}

export default function KeyBudgetFields({ value, onChange }) {
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-text-main">Budgets (USD)</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Leave empty for no limit. When a budget is reached, requests get a 429 until it resets.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {KEY_QUOTA_PERIODS.map(({ id, field, label }) => (
            <Input
              key={id}
              label={label}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              icon="attach_money"
              placeholder="No limit"
              value={value[field]}
              onChange={set(field)}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-text-muted">5-hour is a rolling window. Weekly resets Monday 00:00, monthly on the 1st (server time).</p>
      </div>
      <Input
        label="Expires"
        type="datetime-local"
        value={value.expiresAt}
        onChange={set("expiresAt")}
        hint="Optional. The key stops working at this time."
      />
    </div>
  );
}

KeyBudgetFields.propTypes = {
  value: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

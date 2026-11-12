"use client";

import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import {
  CUSTOM_HEADERS_MAX_COUNT,
  CUSTOM_HEADER_NAME_RE,
  CUSTOM_HEADER_API_KEY_PLACEHOLDER,
  CUSTOM_HEADER_MASK,
  CUSTOM_HEADER_DENYLIST,
} from "open-sse/config/customHeaders.js";

// Row shape: { name, value, keep }. `keep` marks a header loaded from the server
// whose secret value was masked: the value input stays empty and, if left empty,
// the mask sentinel is sent back so the server keeps the stored value.

const inputClass = "min-w-0 rounded-[10px] bg-surface-2 px-3 py-2 text-sm text-text-main placeholder-text-muted/70 border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40";

// Server list (masked) → editor rows. Never carries a raw value into the form.
export function rowsFromNode(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((h) => h && typeof h.name === "string")
    .map((h) => ({ name: h.name, value: "", keep: h.value === CUSTOM_HEADER_MASK }));
}

// Editor rows → API payload ([{ name, value }]); blank-name rows dropped.
export function rowsToPayload(rows) {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), value: r.keep && r.value === "" ? CUSTOM_HEADER_MASK : r.value }));
}

// UX-only pre-check; the server enforces the full rule set.
export function validateRows(rows) {
  const named = rows.filter((r) => r.name.trim());
  if (named.length > CUSTOM_HEADERS_MAX_COUNT) return `Too many custom headers (max ${CUSTOM_HEADERS_MAX_COUNT})`;
  const seen = new Set();
  for (const r of named) {
    const name = r.name.trim();
    if (!CUSTOM_HEADER_NAME_RE.test(name)) return `Invalid header name: ${name}`;
    if (CUSTOM_HEADER_DENYLIST.has(name.toLowerCase())) return `Header ${name} cannot be set`;
    if (seen.has(name.toLowerCase())) return `Duplicate header name: ${name}`;
    seen.add(name.toLowerCase());
  }
  return null;
}

export default function CustomHeadersEditor({ rows, onChange }) {
  const setRow = (i, field, value) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...rows, { name: "", value: "", keep: false }]);
  const error = validateRows(rows);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-main">Custom headers (optional)</label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={row.name}
            onChange={(e) => setRow(i, "name", e.target.value)}
            placeholder="Header-Name"
            spellCheck={false}
            autoComplete="off"
            aria-label="Header name"
            className={`${inputClass} w-2/5`}
          />
          <input
            type="password"
            value={row.value}
            onChange={(e) => setRow(i, "value", e.target.value)}
            placeholder={row.keep ? "Saved (unchanged)" : "Value"}
            spellCheck={false}
            autoComplete="new-password"
            aria-label="Header value"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            title="Remove header"
            onClick={() => removeRow(i)}
            className="shrink-0 text-text-muted hover:text-red-500"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      ))}
      {rows.length < CUSTOM_HEADERS_MAX_COUNT && (
        <div>
          <Button type="button" variant="ghost" size="xs" icon="add" onClick={addRow}>
            Add header
          </Button>
        </div>
      )}
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <p className="text-xs text-text-muted">
          Sent on every request to this node and override defaults. Use {CUSTOM_HEADER_API_KEY_PLACEHOLDER} to insert the connection&apos;s API key; an empty value removes that header (e.g. Authorization).
        </p>
      )}
    </div>
  );
}

CustomHeadersEditor.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    value: PropTypes.string,
    keep: PropTypes.bool,
  })).isRequired,
  onChange: PropTypes.func.isRequired,
};

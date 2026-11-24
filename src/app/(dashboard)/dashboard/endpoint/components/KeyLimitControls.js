"use client";

// Per-API-key cost limit on the Endpoint page. Behind a "Cost limit" switch, like
// "Restrict access" and fully independent of it: the switch is never disabled, the
// fields show once it is on, and switching it off clears the limit. A saved limit
// that cannot be enforced (the key is unrestricted or can reach an unpriced model)
// is kept, greyed out with a red warning.
import { useState } from "react";
import PropTypes from "prop-types";
import { Toggle } from "@/shared/components";
import { KEY_LIMIT_WINDOW } from "@/shared/constants/keyAccess.js";
import { keyLimitView, limitSwitchState } from "@/shared/utils/keyLimitView.js";

export default function KeyLimitControls({ apiKey, onChange }) {
  const view = keyLimitView(apiKey);
  const limit = apiKey.limit;
  const [open, setOpen] = useState(false); // switched on here, nothing saved yet
  const [usd, setUsd] = useState(limit ? String(limit.usd) : "");
  const [windowKind, setWindowKind] = useState(limit?.window || KEY_LIMIT_WINDOW.DAY);
  const { on } = limitSwitchState(apiKey, open);

  const toggle = (checked) => {
    if (checked) return setOpen(true);
    setOpen(false);
    setUsd("");
    if (limit) onChange(null);
  };

  const save = () => {
    const n = Number(usd);
    if (usd.trim() === "") return limit ? onChange(null) : undefined;
    if (Number.isFinite(n) && n > 0) onChange({ usd: n, window: windowKind });
  };

  return (
    <div className="mt-2" data-testid="key-limit">
      <Toggle size="sm" checked={on} label="Cost limit" onChange={toggle} />
      {on && (
        <>
          <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${view.greyed ? "opacity-60" : ""}`} data-testid="key-limit-fields">
            <span>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
              onBlur={save}
              placeholder="amount"
              className="w-24 rounded border border-black/10 bg-transparent px-2 py-0.5 text-text-main dark:border-white/10"
              aria-label={`Cost limit in USD for ${apiKey.name}`}
            />
            <select
              value={windowKind}
              onChange={(e) => {
                setWindowKind(e.target.value);
                if (usd.trim() !== "" && Number(usd) > 0) onChange({ usd: Number(usd), window: e.target.value });
              }}
              className="rounded border border-black/10 bg-transparent px-1 py-0.5 text-text-main dark:border-white/10"
              aria-label={`Cost limit window for ${apiKey.name}`}
            >
              <option value={KEY_LIMIT_WINDOW.DAY}>per day</option>
              <option value={KEY_LIMIT_WINDOW.MONTH}>per month</option>
            </select>
            {view.summary && <span className="text-text-muted">{view.summary}</span>}
          </div>
          {view.note && <p className="mt-1 text-xs text-text-muted">{view.note}</p>}
          {view.warning && <p className="mt-1 text-xs font-medium text-red-500" role="alert">{view.warning}</p>}
          {apiKey.limitError && <p className="mt-1 text-xs text-red-500" role="alert">{apiKey.limitError}</p>}
        </>
      )}
    </div>
  );
}

KeyLimitControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    limit: PropTypes.shape({ usd: PropTypes.number, window: PropTypes.string }),
    limitStatus: PropTypes.object,
    limitError: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};

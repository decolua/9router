"use client";

import PropTypes from "prop-types";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { API_MODE_DEFAULT, API_MODE_HINTS, API_MODE_LABELS } from "open-sse/config/apiModeConstants.js";

// Per-connection upstream endpoint picker (Auto / Chat / Responses) for providers
// whose registry declares `apiModes`. Value is stored as providerSpecificData.apiMode.
export default function ApiModeSelector({ modes, value, onChange }) {
  if (!Array.isArray(modes) || !modes.length) return null;
  const current = modes.includes(value) ? value : API_MODE_DEFAULT;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-main">API Endpoint</span>
      <SegmentedControl
        size="sm"
        options={modes.map((m) => ({ value: m, label: API_MODE_LABELS[m] || m }))}
        value={current}
        onChange={onChange}
      />
      <p className="text-xs text-text-muted">{API_MODE_HINTS[current]}</p>
    </div>
  );
}

ApiModeSelector.propTypes = {
  modes: PropTypes.arrayOf(PropTypes.string),
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

"use client";

import PropTypes from "prop-types";
import { Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import {
  CLIENT_IDENTITY_PROFILE_OPTIONS,
  CUSTOM_CLIENT_IDENTITY_PROFILE,
  DEFAULT_CLIENT_IDENTITY_PROFILE,
  normalizeClientIdentityData,
} from "open-sse/config/clientIdentity.js";

// Form state <-> API payload for the client identity fields of a compatible node.
export function clientIdentityFormState(node) {
  const headers = node?.clientIdentityHeaders || {};
  return {
    clientIdentityProfile: node?.clientIdentityProfile || DEFAULT_CLIENT_IDENTITY_PROFILE,
    clientIdentityHeadersText: Object.keys(headers).length ? JSON.stringify(headers, null, 2) : "",
  };
}

// Returns { clientIdentityProfile, clientIdentityHeaders } or { error }.
export function clientIdentityPayload(formData) {
  return normalizeClientIdentityData({
    clientIdentityProfile: formData.clientIdentityProfile,
    clientIdentityHeaders: formData.clientIdentityHeadersText,
  });
}

export default function ClientIdentityFields({ profile, headersText, error, onChange }) {
  return (
    <>
      <Select
        label="Client Identity"
        options={CLIENT_IDENTITY_PROFILE_OPTIONS}
        value={profile}
        onChange={(e) => onChange({ clientIdentityProfile: e.target.value })}
        hint="Optional. Sends the selected client's identity headers to this gateway."
      />
      {profile === CUSTOM_CLIENT_IDENTITY_PROFILE && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-main">Custom Headers</label>
          <textarea
            value={headersText}
            onChange={(e) => onChange({ clientIdentityHeadersText: e.target.value })}
            placeholder={'{\n  "User-Agent": "custom/1.0"\n}'}
            rows={5}
            className={cn(
              "w-full resize-y rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 font-mono text-[16px] text-text-main sm:text-sm",
              "placeholder-text-muted/70 transition-all duration-150 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30",
              error && "border-red-500/40 ring-1 ring-red-500"
            )}
          />
          {error
            ? <p className="text-xs text-red-500">{error}</p>
            : <p className="text-xs text-text-muted">JSON object or Header: value lines. Authorization, x-api-key, api-key and cookie are ignored.</p>}
        </div>
      )}
    </>
  );
}

ClientIdentityFields.propTypes = {
  profile: PropTypes.string.isRequired,
  headersText: PropTypes.string,
  error: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

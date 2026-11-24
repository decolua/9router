"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import Toggle from "./Toggle";
import { TOKEN_SAVER_MODULES } from "@/shared/constants/tokenSaver.js";
import { resolveTokenSaverFlags } from "@/shared/utils/tokenSaver.js";

export default function TokenSaverControls({ value = null, globalSettings, onSave, onReloadSettings }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const save = async (next) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      if (!value) {
        const settings = await onReloadSettings();
        if (!settings) throw new Error("Failed to refresh global token saver settings");
        next = { ...next, ...resolveTokenSaverFlags(settings, null) };
      }
      await onSave(next);
    } catch (err) {
      setError(err.message || "Failed to save token saver settings");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const toggleOverride = (overrideEnabled) => {
    if (!value && !globalSettings) return;
    save(value
      ? { ...value, overrideEnabled }
      : { overrideEnabled, enabled: true });
  };

  return (
    <div className="mt-2" data-testid="key-token-saver" aria-busy={saving}>
      <Toggle
        size="sm"
        label="Override token saver settings"
        checked={value?.overrideEnabled === true}
        disabled={saving || (!value && !globalSettings)}
        onChange={toggleOverride}
      />
      {!value?.overrideEnabled && (
        <p className="mt-1 text-xs text-text-muted">
          Uses <a href="/dashboard/token-saver" className="text-primary underline">global token saver settings</a>.
        </p>
      )}
      {!value && !globalSettings && (
        <p className="mt-1 text-xs text-text-muted">
          Global settings are unavailable. <button type="button" onClick={onReloadSettings} className="text-primary underline">Retry loading settings</button>
        </p>
      )}
      {value?.overrideEnabled && (
        <fieldset className="mt-2 space-y-2 border-l-2 border-border pl-3" disabled={saving}>
          <legend className="sr-only">Token saver overrides</legend>
          <div className="flex items-center gap-2">
            <Toggle size="sm" label="Token savers" checked={value.enabled} onChange={(enabled) => save({ ...value, enabled })} />
            <span className="text-xs text-text-muted">{value.enabled ? "ON" : "OFF"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {TOKEN_SAVER_MODULES.map(({ field, label }) => (
              <Toggle key={field} size="sm" label={label} checked={value[field]} disabled={saving || !value.enabled} onChange={(checked) => save({ ...value, [field]: checked })} />
            ))}
          </div>
          <p className="text-xs text-text-muted">Levels and connection settings remain global. Custom system prompt and experimental PXPIPE are not affected by these controls.</p>
          <p className="text-xs text-text-muted">Enabling Headroom sends messages to the configured Headroom endpoint, even when its global default is OFF.</p>
        </fieldset>
      )}
      {error && <p className="mt-1 text-xs text-red-500" role="alert">{error}</p>}
    </div>
  );
}

TokenSaverControls.propTypes = {
  value: PropTypes.object,
  globalSettings: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onReloadSettings: PropTypes.func.isRequired,
};

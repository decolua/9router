"use client";

// Per-API-key access control on the Endpoint page.
// "Restrict access" toggle per key; when on, the key may call only the listed
// combos/models, shown as removable badges. Entries are picked with the same
// shared ModelSelectModal the combo editor uses (combos first, then models),
// added as a whole provider ("provider/*"), or typed by hand.
import { useState } from "react";
import PropTypes from "prop-types";
import { Toggle, ModelSelectModal } from "@/shared/components";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { KEY_ACCESS_PROVIDER_WILDCARD_SUFFIX, keyAccessWildcardProvider } from "@/shared/constants/keyAccess.js";

export default function KeyAccessControls({ apiKey, onChange, onRequestRestrict }) {
  const access = apiKey.access || { restricted: false, allow: [] };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [typed, setTyped] = useState("");

  const loadProviders = async () => {
    if (providersLoaded) return;
    setProvidersLoaded(true);
    // Same sources the combo editor feeds the picker with.
    try {
      const [providersRes, aliasRes] = await Promise.all([fetch("/api/providers"), fetch("/api/models/alias")]);
      if (providersRes.ok) setActiveProviders((await providersRes.json()).connections || []);
      if (aliasRes.ok) setModelAliases((await aliasRes.json()).aliases || {});
    } catch (error) {
      console.log("Error loading picker data:", error);
    }
  };

  const openPicker = () => {
    setPickerOpen(true);
    loadProviders();
  };

  const setAllow = (allow) => onChange({ restricted: true, allow });
  const addValue = (value) => {
    const entry = String(value || "").trim();
    if (entry && !access.allow.some((e) => e.toLowerCase() === entry.toLowerCase())) setAllow([...access.allow, entry]);
  };
  const add = (model) => addValue(model?.value);
  const remove = (value) => setAllow(access.allow.filter((e) => e !== value));

  const addTyped = () => {
    addValue(typed);
    setTyped("");
  };

  // One option per connected provider, by the alias requests use ("cc/…" → "cc/*").
  const providerOptions = [];
  const seen = new Set();
  for (const conn of activeProviders) {
    const alias = getProviderAlias(conn.provider) || conn.provider;
    const entry = `${alias}${KEY_ACCESS_PROVIDER_WILDCARD_SUFFIX}`;
    if (seen.has(alias) || access.allow.some((e) => e.toLowerCase() === entry.toLowerCase())) continue;
    seen.add(alias);
    providerOptions.push({ value: entry, label: AI_PROVIDERS[conn.provider]?.name || conn.provider });
  }
  providerOptions.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mt-2" data-testid="key-access">
      <Toggle
        size="sm"
        checked={access.restricted}
        label="Restrict access"
        onChange={(checked) => (checked ? onRequestRestrict() : onChange({ restricted: false, allow: access.allow }))}
      />
      {access.restricted && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {access.allow.length === 0 && (
              <span className="text-xs text-orange-500">No combos or models allowed — this key can call nothing.</span>
            )}
            {access.allow.map((entry) => {
              const wholeProvider = keyAccessWildcardProvider(entry);
              return (
                <span
                  key={entry}
                  className="flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-text-main"
                  title={wholeProvider ? `Every model of provider "${wholeProvider}"` : undefined}
                >
                  {entry}
                  <button
                    onClick={() => remove(entry)}
                    className="rounded text-text-muted hover:text-red-500"
                    title={`Remove ${entry}`}
                    aria-label={`Remove ${entry}`}
                  >
                    <span className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>close</span>
                  </button>
                </span>
              );
            })}
            <button
              onClick={openPicker}
              className="flex items-center gap-0.5 rounded-xl border border-dashed border-black/10 px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50 dark:border-white/10"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>add</span>
              Add combo or model
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value=""
              onFocus={loadProviders}
              onMouseDown={loadProviders}
              onChange={(e) => addValue(e.target.value)}
              className="min-w-0 rounded-xl border border-black/10 bg-transparent px-2 py-0.5 text-xs text-text-main dark:border-white/10"
              aria-label="Allow every model of a provider"
            >
              <option value="" disabled>All models of a provider…</option>
              {providerOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label} ({o.value})</option>
              ))}
            </select>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
              placeholder="Type a model, combo or provider/*"
              aria-label="Type an allowed model, combo or provider/*"
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-2 py-0.5 font-mono text-xs text-text-main outline-none focus:border-primary/50 dark:border-white/10"
            />
            <button
              onClick={addTyped}
              disabled={!typed.trim()}
              className="rounded-xl border border-black/10 px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10"
            >
              Add
            </button>
          </div>
        </div>
      )}
      {pickerOpen && (
        <ModelSelectModal
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={add}
          onDeselect={(model) => remove(access.allow.find((e) => e.toLowerCase() === String(model?.value).toLowerCase()))}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Allowed for "${apiKey.name}"`}
          addedModelValues={access.allow}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}

KeyAccessControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    access: PropTypes.shape({ restricted: PropTypes.bool, allow: PropTypes.arrayOf(PropTypes.string) }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRequestRestrict: PropTypes.func.isRequired,
};

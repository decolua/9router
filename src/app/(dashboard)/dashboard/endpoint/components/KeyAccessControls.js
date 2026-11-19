"use client";

// Per-API-key access control on the Endpoint page.
// "Restrict access" toggle per key; when on, the key may call only the listed
// combos/models, shown as removable badges. Entries are picked with the same
// shared ModelSelectModal the combo editor uses (combos first, then models).
import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Toggle, ModelSelectModal } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import AccountSelectModal from "./AccountSelectModal";

export default function KeyAccessControls({ apiKey, onChange: onSave, onRequestRestrict }) {
  const access = { restricted: false, allow: [], accountsRestricted: false, accountIds: [], ...apiKey.access };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(false);
  const [accountsRetry, setAccountsRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const onChange = async (nextAccess) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(nextAccess);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!access.accountsRestricted) return;
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load accounts");
        const data = await response.json();
        if (!Array.isArray(data.connections)) throw new Error("Invalid accounts response");
        // Keep only display fields, never credentials, in account picker state.
        if (!controller.signal.aborted) setAccounts(data.connections.filter((account) => typeof account.id === "string").map(({ id, provider, name, email }) => ({ id, provider, name, email })));
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccountsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAccountsLoading(false);
      });
    return () => controller.abort();
  }, [access.accountsRestricted, accountsRetry]);

  const openPicker = async () => {
    setPickerOpen(true);
    // Same sources the combo editor feeds the picker with.
    try {
      const [providersRes, aliasRes] = await Promise.all([fetch("/api/providers"), fetch("/api/models/alias")]);
      if (providersRes.ok) setActiveProviders((await providersRes.json()).connections || []);
      if (aliasRes.ok) setModelAliases((await aliasRes.json()).aliases || {});
    } catch (error) {
      console.log("Error loading picker data:", error);
    }
  };

  const setAllow = (allow) => onChange({ ...access, restricted: true, allow });
  const add = (model) => {
    const value = model?.value;
    if (value && !access.allow.some((e) => e.toLowerCase() === value.toLowerCase())) setAllow([...access.allow, value]);
  };
  const remove = (value) => setAllow(access.allow.filter((e) => e !== value));

  return (
    <fieldset disabled={saving} aria-busy={saving} className="mt-2 min-w-0" data-testid="key-access">
      <Toggle
        size="sm"
        checked={access.restricted}
        label="Restrict access"
        onChange={(checked) => (checked ? onRequestRestrict() : onChange({ ...access, restricted: false }))}
      />
      {access.restricted && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {access.allow.length === 0 && (
            <span className="text-xs text-orange-500">No combos or models allowed — this key can call nothing.</span>
          )}
          {access.allow.map((entry) => (
            <span key={entry} className="flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-text-main">
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
          ))}
          <button
            onClick={openPicker}
            className="flex items-center gap-0.5 rounded-xl border border-dashed border-black/10 px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50 dark:border-white/10"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>add</span>
            Add combo or model
          </button>
        </div>
      )}
      <div className="mt-3" data-testid="key-account-access">
        <Toggle
          size="sm"
          checked={access.accountsRestricted}
          label="Restrict accounts"
          onChange={(accountsRestricted) => {
            setAccountsLoading(true);
            setAccountsError(false);
            onChange({ ...access, accountsRestricted });
          }}
        />
        {access.accountsRestricted && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-text-muted">Allowed provider accounts (independent of model restrictions)</p>
            {access.accountIds.length === 0 && (
              <p className="text-xs text-orange-500">No accounts allowed. Select at least one account to allow provider connections.</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {access.accountIds.map((id) => {
                const account = accounts.find((entry) => entry.id === id);
                const label = account
                  ? `${AI_PROVIDERS[account.provider]?.name || account.provider}: ${account.name || account.email || "Unnamed account"}`
                  : `${accountsLoading || accountsError ? "Account" : "Unavailable account"} (${id})`;
                return (
                  <span key={id} title={account?.email || id} className="flex max-w-full items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-text-main">
                    <span className="truncate">{label}</span>
                    <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange({ ...access, accountIds: access.accountIds.filter((accountId) => accountId !== id) })} className="shrink-0 rounded text-text-muted hover:text-red-500">
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>close</span>
                    </button>
                  </span>
                );
              })}
              <button type="button" onClick={() => setAccountPickerOpen(true)} className="flex items-center gap-0.5 rounded-xl border border-dashed border-border-subtle px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50">
                <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>add</span>
                Add account
              </button>
            </div>
            {accountsLoading && <p role="status" className="text-xs text-text-muted">Loading accounts...</p>}
            {accountsError && <p role="alert" className="text-xs text-red-500">Could not load accounts. Open Add account to retry.</p>}
            <p className="text-xs text-text-muted">Model choices show only allowed accounts. Combos stay available, with fallback limited to allowed accounts.</p>
          </div>
        )}
      </div>
      {accountPickerOpen && access.accountsRestricted && (
        <AccountSelectModal
          isOpen={accountPickerOpen}
          onClose={() => setAccountPickerOpen(false)}
          accounts={accounts}
          selectedIds={access.accountIds}
          onChange={(accountIds) => onChange({ ...access, accountIds })}
          loading={accountsLoading}
          error={accountsError}
          onRetry={() => {
            setAccountsLoading(true);
            setAccountsError(false);
            setAccountsRetry((value) => value + 1);
          }}
          saving={saving}
        />
      )}
      {pickerOpen && (
        <ModelSelectModal
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={add}
          onDeselect={(model) => remove(access.allow.find((e) => e.toLowerCase() === String(model?.value).toLowerCase()))}
          activeProviders={activeProviders}
          allowedConnectionIds={access.accountsRestricted ? access.accountIds : null}
          modelAliases={modelAliases}
          title={`Allowed for "${apiKey.name}"`}
          addedModelValues={access.allow}
          closeOnSelect={false}
        />
      )}
    </fieldset>
  );
}

KeyAccessControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    access: PropTypes.shape({
      restricted: PropTypes.bool,
      allow: PropTypes.arrayOf(PropTypes.string),
      accountsRestricted: PropTypes.bool,
      accountIds: PropTypes.arrayOf(PropTypes.string),
    }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRequestRestrict: PropTypes.func.isRequired,
};

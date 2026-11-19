"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { SelectionToolbar, SelectionAction, SelectionGroup, SelectionChip } from "@/shared/components/SelectionPicker";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export default function AccountSelectModal({ isOpen, onClose, accounts, selectedIds, onChange, loading, error, onRetry, saving }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = accounts.filter((account) => [account.name, account.email, account.provider, AI_PROVIDERS[account.provider]?.name]
    .some((value) => String(value || "").toLowerCase().includes(query)));
  const groups = visible.reduce((result, account) => {
    const providerId = account.provider || "unknown";
    (result[providerId] ||= []).push(account);
    return result;
  }, Object.create(null));
  const unavailable = selectedIds.filter((id) => !accounts.some((account) => account.id === id));
  const canSelect = !saving && !loading && !error;
  const change = (ids) => { if (!saving) onChange(ids); };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Allowed provider accounts" size="lg">
      <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-4">
        <p className="text-xs text-text-muted">Choose accounts independently of model restrictions. {selectedIds.length} selected.</p>
        <SelectionToolbar
          searchLabel="Search accounts"
          searchProps={{ type: "search", value: search, onChange: (event) => setSearch(event.target.value), placeholder: "Search name, email or provider" }}
          count={`${visible.length} visible`}
        >
          <SelectionAction disabled={!canSelect || visible.length === 0} onClick={() => change([...new Set([...selectedIds, ...visible.map((account) => account.id)])])}>Select all visible</SelectionAction>
          <SelectionAction muted disabled={!canSelect || visible.length === 0} onClick={() => change(selectedIds.filter((id) => !visible.some((account) => account.id === id)))}>Deselect all visible</SelectionAction>
        </SelectionToolbar>
        {loading && <p role="status" className="text-sm text-text-muted">Loading accounts...</p>}
        {error && <p role="alert" className="text-sm text-red-500">Could not load accounts. <button type="button" onClick={onRetry} className="underline">Retry</button></p>}
        {!loading && !error && (
          <div className="space-y-4">
            {visible.length === 0 && <p className="text-sm text-text-muted">{accounts.length ? "No accounts match your search." : "No provider accounts found."}</p>}
            {Object.entries(groups).map(([providerId, group]) => {
              const provider = AI_PROVIDERS[providerId];
              const name = provider?.name || providerId;
              return (
                <SelectionGroup key={providerId} as="section" headerAs="h3" label={`${name} accounts`}
                  color={provider?.color}
                  icon={<ProviderIcon providerId={providerId} alt="" size={18} fallbackText={name.slice(0, 2).toUpperCase()} fallbackColor={provider?.color} />}
                  name={name} count={`${group.filter((account) => selectedIds.includes(account.id)).length}/${group.length}`}
                >
                    {group.map((account) => {
                      const selected = selectedIds.includes(account.id);
                      return (
                        <SelectionChip
                          selected={selected}
                          key={account.id}
                          type="button"
                          aria-pressed={selected}
                          title={account.email || account.id}
                          onClick={() => change(selected ? selectedIds.filter((id) => id !== account.id) : [...selectedIds, account.id])}
                        >
                          <span className="block truncate font-medium">{selected && <span aria-hidden="true">✓ </span>}{account.name || account.email || "Unnamed account"}</span>
                          {account.name && account.email && account.name !== account.email && <span className={`block truncate ${selected ? "text-white/80" : "text-text-muted"}`}>{account.email}</span>}
                        </SelectionChip>
                      );
                    })}
                </SelectionGroup>
              );
            })}
          </div>
        )}
        {!loading && !error && unavailable.length > 0 && (
          <section aria-label="Unavailable accounts" className="space-y-2">
            <h3 className="text-xs text-text-muted">Unavailable accounts (remove only)</h3>
            {unavailable.map((id) => <button key={id} type="button" onClick={() => change(selectedIds.filter((accountId) => accountId !== id))} aria-label={`Remove unavailable account ${id}`} className="mr-2 max-w-full break-all rounded-lg border border-border-subtle px-2 py-1 text-xs text-text-muted">Unavailable account ({id}) ×</button>)}
          </section>
        )}
      </fieldset>
    </Modal>
  );
}

AccountSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  accounts: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, provider: PropTypes.string, name: PropTypes.string, email: PropTypes.string })).isRequired,
  selectedIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.bool.isRequired,
  onRetry: PropTypes.func.isRequired,
  saving: PropTypes.bool.isRequired,
};

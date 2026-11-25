"use client";

import { useId, useState } from "react";
import { Badge, Button, Toggle, Tooltip } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { translate } from "@/i18n/runtime";
import { getStatusVariant } from "@/shared/utils/connectionStatus";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { accountLabel, toggleAccount } from "@/shared/utils/keyConnections";

function providerName(account) {
  return AI_PROVIDERS[account.provider]?.name || account.providerSpecificData?.nodeName || account.provider;
}

const lastAccountHint = "At least one account must stay on. Use model access to disable this provider.";
const capHint = "Account selection limit reached";

function ProviderAccounts({ accounts, selected, onChange, disabled, onOpen }) {
  const id = useId();
  const ids = new Set(accounts.map((account) => account.id));
  const pinned = selected.filter((value) => ids.has(value));
  const restricted = pinned.length > 0;
  const [open, setOpen] = useState(restricted);
  const first = accounts[0];
  const name = providerName(first);

  return (
    <div className="min-w-0 rounded-lg border border-border">
      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            if (!open) onOpen?.();
            setOpen(!open);
          }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-start hover:text-primary"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2">
            <ProviderIcon providerId={first.provider} alt="" size={26} fallbackText={name.slice(0, 2)} />
          </span>
          <span className="min-w-0 flex-1">
            <strong data-i18n-skip className="block break-words text-sm">
              {name}
            </strong>
            <Badge size="sm" variant={restricted ? "primary" : "default"}>
              {restricted ? (
                <span data-i18n-skip>{`${pinned.length}/${accounts.length} ${translate(accounts.length === 1 ? "account" : "accounts")}`}</span>
              ) : (
                "All accounts"
              )}
            </Badge>
          </span>
          <span aria-hidden="true" className="material-symbols-outlined text-text-muted">
            {open ? "expand_less" : "expand_more"}
          </span>
        </button>
        {restricted && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-primary"
            disabled={disabled}
            onClick={() => onChange(selected.filter((value) => !ids.has(value)))}
          >
            Enable all
          </Button>
        )}
      </div>
      <div id={id} hidden={!open} className="border-t border-border px-3">
        {!restricted && <p className="pt-2 text-xs text-text-muted">All accounts on: no restriction</p>}
        <ul className="divide-y divide-border">
          {accounts.map((account) => {
            const label = accountLabel(account);
            const checked = !restricted || pinned.includes(account.id);
            const next = toggleAccount(selected, accounts, account.id, !checked);
            const last = checked && (restricted ? pinned.length : accounts.length) === 1;
            const hint = last ? lastAccountHint : next === selected ? capHint : null;
            const warning =
              account.isActive === false
                ? "Inactive"
                : account.lastError || getStatusVariant(account.isActive, account.testStatus) === "error"
                  ? "Error"
                  : null;
            const control = (
              <Toggle
                size="sm"
                aria-label={label}
                checked={checked}
                disabled={disabled || Boolean(hint)}
                onChange={() => onChange(next)}
              />
            );
            return (
              <li key={account.id} className="flex min-h-10 items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span data-i18n-skip className="break-all text-sm">
                    {label}
                  </span>
                  {warning && (
                    <Badge size="sm" variant="warning">
                      {warning}
                    </Badge>
                  )}
                </div>
                {hint ? (
                  <Tooltip text={hint}>
                    <div tabIndex={0} title={translate(hint)} aria-label={translate(hint)}>
                      {control}
                    </div>
                  </Tooltip>
                ) : (
                  control
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function KeyAccountPicker({ connections, selected, onChange, disabled = false, onOpen }) {
  if (connections === null) return <p role="status">Loading accounts</p>;
  if (!Array.isArray(connections)) return <p role="alert">Could not load accounts</p>;

  const groups = new Map();
  const available = new Set();
  for (const account of connections) {
    available.add(account.id);
    if (!groups.has(account.provider)) groups.set(account.provider, []);
    groups.get(account.provider).push(account);
  }
  const deleted = selected.filter((id) => !available.has(id));
  // Providers with more accounts first, so the pool people pin (e.g. Codex) leads.
  const ordered = Array.from(groups).sort(([a, x], [b, y]) =>
    y.length - x.length || providerName(x[0]).localeCompare(providerName(y[0])) || a.localeCompare(b));

  return (
    <div className="space-y-2">
      {!connections.length && <p className="text-sm text-text-muted">No accounts available</p>}
      {ordered.map(([provider, accounts]) => (
        <ProviderAccounts
          key={provider}
          accounts={accounts}
          onOpen={onOpen}
          selected={selected}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
      {deleted.length > 0 && (
        <fieldset className="min-w-0 rounded-lg border border-border px-3">
          <legend className="px-1 text-xs font-semibold text-text-muted">Deleted accounts</legend>
          {deleted.map((id) => (
            <div key={id} className="flex items-center justify-between gap-2 py-1">
              <code className="break-all text-xs">{id}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon="close"
                aria-label={translate("Remove") + ": " + id}
                disabled={disabled}
                onClick={() => onChange(selected.filter((value) => value !== id))}
              />
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}

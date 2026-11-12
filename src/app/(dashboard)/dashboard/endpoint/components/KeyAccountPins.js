"use client";

// Per-API-key account pinning on the Endpoint page.
// By default a key may use every connected account of a provider (today's
// behaviour). Ticking one or more accounts of a provider pins the key to just
// those accounts for that provider; providers with nothing ticked stay open.
import { useState } from "react";
import PropTypes from "prop-types";

const connectionLabel = (c) => c.displayName || c.name || c.email || c.id.slice(0, 8);

export default function KeyAccountPins({ apiKey, onChange }) {
  const pins = apiKey.access?.connections || {};
  const pinnedCount = Object.values(pins).reduce((n, ids) => n + ids.length, 0);
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState(null);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && connections === null) {
      try {
        const res = await fetch("/api/providers");
        if (res.ok) setConnections((await res.json()).connections || []);
        else setConnections([]);
      } catch (error) {
        console.log("Error loading provider accounts:", error);
        setConnections([]);
      }
    }
  };

  const save = (nextPins) => {
    const cleaned = Object.fromEntries(Object.entries(nextPins).filter(([, ids]) => ids.length > 0));
    onChange({ restricted: !!apiKey.access?.restricted, allow: apiKey.access?.allow || [], connections: cleaned });
  };

  const toggleAccount = (provider, id) => {
    const current = pins[provider] || [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    save({ ...pins, [provider]: next });
  };

  const byProvider = {};
  for (const c of connections || []) (byProvider[c.provider] ||= []).push(c);
  // A pinned id whose account no longer exists is kept visible so it can be cleared.
  const knownIds = new Set((connections || []).map((c) => c.id));
  const orphans = Object.entries(pins).flatMap(([provider, ids]) => ids.filter((id) => !knownIds.has(id)).map((id) => ({ provider, id })));

  return (
    <div className="mt-2" data-testid="key-account-pins">
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-main"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>
          {open ? "expand_more" : "chevron_right"}
        </span>
        {pinnedCount === 0 ? "Accounts: any (default)" : `Accounts: pinned to ${pinnedCount}`}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-black/5 p-2 dark:border-white/5">
          <p className="text-xs text-text-muted">
            Tick the accounts this key may use. A provider with nothing ticked can use any of its accounts.
            Fallback never leaves the ticked accounts.
          </p>
          {connections === null && <span className="text-xs text-text-muted">Loading accounts…</span>}
          {connections !== null && Object.keys(byProvider).length === 0 && orphans.length === 0 && (
            <span className="text-xs text-text-muted">No connected accounts yet.</span>
          )}
          {Object.entries(byProvider).map(([provider, list]) => (
            <div key={provider}>
              <div className="font-mono text-xs text-text-main">{provider}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {list.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1 text-xs text-text-main">
                    <input
                      type="checkbox"
                      checked={(pins[provider] || []).includes(c.id)}
                      onChange={() => toggleAccount(provider, c.id)}
                    />
                    {connectionLabel(c)}
                    {c.isActive === false && <span className="text-orange-500">(inactive)</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {orphans.map(({ provider, id }) => (
            <label key={`${provider}:${id}`} className="flex cursor-pointer items-center gap-1 text-xs text-orange-500">
              <input type="checkbox" checked onChange={() => toggleAccount(provider, id)} />
              {provider}: deleted account {id.slice(0, 8)} (untick to remove)
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

KeyAccountPins.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    access: PropTypes.shape({
      restricted: PropTypes.bool,
      allow: PropTypes.arrayOf(PropTypes.string),
      connections: PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string)),
    }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};

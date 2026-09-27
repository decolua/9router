"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./QuotaTable";
import {
  getConnectionLabel,
  filterQuotasByVisibility,
  groupConnectionsByProvider,
  pickGroupedConnection,
} from "./utils";

/**
 * Quota tracker, one card per provider instead of one per account.
 *
 * The flat list shows every account at once, which is what you want when you
 * are looking for the one that ran out. It is the wrong shape when a provider
 * holds a dozen accounts and you only care about one at a time — so here each
 * provider gets a single card with a picker, and only the selected account's
 * quota is drawn.
 *
 * Selection is per provider and lives in this component: switching to grouped
 * view and back leaves the flat list untouched.
 */
export default function GroupedByProvider({
  connections,
  // Defaults live here, not in defaultProps: React 19 dropped defaultProps for
  // function components, so they would silently not apply and the first
  // quotaData lookup would throw.
  quotaData = {},
  loading = {},
  errors = {},
  onRefresh,
  onHideQuota,
  // Same hidden-row set the flat list applies, so a quota someone hid does
  // not reappear just because they switched view.
  quotaVisibility = {},
}) {
  const groups = useMemo(() => groupConnectionsByProvider(connections), [connections]);

  // providerId → chosen connection id. Absent means "the first one".
  const [selected, setSelected] = useState({});

  if (groups.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {groups.map(({ provider, connections: conns }) => {
        // A selection can outlive the account it pointed at (deleted, or moved
        // to another page), so fall back rather than render an empty card.
        const chosen = pickGroupedConnection(conns, selected[provider]);
        const quota = quotaData[chosen.id];
        const isLoading = loading[chosen.id];
        const error = errors[chosen.id];
        const quotas = filterQuotasByVisibility(provider, quota?.quotas || [], quotaVisibility);
        const inactive = chosen.isActive === false;

        return (
          <div
            key={provider}
            className="rounded-[14px] border border-border-subtle bg-surface p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <ProviderIcon providerId={provider} className="h-5 w-5 shrink-0" />
              <span className="truncate text-sm font-semibold text-text-main">{provider}</span>
              <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
                {conns.length} {conns.length === 1 ? "account" : "accounts"}
              </span>
              <button
                type="button"
                onClick={() => onRefresh?.(chosen.id, provider)}
                disabled={isLoading}
                aria-label="Refresh quota"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-50 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
              </button>
            </div>

            {/* One picker per provider — the point of this view. Kept as a
                native select so it stays usable at phone width. */}
            <select
              value={chosen.id}
              onChange={(e) => setSelected((prev) => ({ ...prev, [provider]: e.target.value }))}
              className="mb-2 w-full rounded-lg border border-border-subtle bg-surface-2 px-2 py-1.5 text-xs text-text-main"
              aria-label={`Account for ${provider}`}
            >
              {conns.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {getConnectionLabel(conn) || conn.name || conn.email || conn.id}
                  {conn.isActive === false ? " — inactive" : ""}
                </option>
              ))}
            </select>

            {inactive && (
              <div className="mb-2 rounded-md bg-surface-2 px-2 py-1 text-[10px] text-text-muted">
                This account is switched off, so it is not being routed to.
              </div>
            )}

            {error ? (
              <p className="py-4 text-center text-xs text-red-500">{error}</p>
            ) : isLoading ? (
              <p className="py-4 text-center text-xs text-text-muted">Loading…</p>
            ) : quotas && quotas.length > 0 ? (
              <QuotaTable
                quotas={quotas}
                compact
                sortMode="default"
                onHideQuota={(quotaRow) => onHideQuota?.(provider, quotaRow)}
              />
            ) : (
              <p className="py-4 text-center text-xs text-text-muted">
                {quota?.message || "No quota reported."}
              </p>
            )}

            {/* Where the numbers came from. Providers that report no quota of
                their own say so here rather than looking like a limit. */}
            {quota?.message && quotas && quotas.length > 0 && (
              <p className="mt-2 px-1 text-[10px] leading-relaxed text-text-muted">
                {quota.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

GroupedByProvider.propTypes = {
  connections: PropTypes.arrayOf(PropTypes.object).isRequired,
  quotaData: PropTypes.object,
  loading: PropTypes.object,
  errors: PropTypes.object,
  onRefresh: PropTypes.func,
  onHideQuota: PropTypes.func,
  quotaVisibility: PropTypes.object,
};

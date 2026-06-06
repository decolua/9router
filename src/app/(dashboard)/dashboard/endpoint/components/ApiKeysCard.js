"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import { Button, Card, Toggle } from "@/shared/components";
import { formatLimitState, getLimitBadgeClass } from "../utils/endpointLimitHelpers";
import { SecurityWarning } from "./SecurityWarning";
import { StatusAlert } from "./StatusAlert";

export function ApiKeysCard({
  keys,
  copied,
  requireApiKey,
  isRemoteHost,
  keyActionStatus,
  visibleKeys,
  savingKeyId,
  onCreateClick,
  onRequireApiKeyChange,
  onCopy,
  onToggleVisibility,
  onEditKey,
  onPauseKey,
  onToggleKey,
  onDeleteKey,
  maskKey,
}) {
  return (
    <Card id="require-api-key">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            vpn_key
          </span>
          API Keys
        </h2>
        <Button icon="add" onClick={onCreateClick}>
          Create Key
        </Button>
      </div>

      <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
        <div>
          <p className="font-medium">Require API key</p>
          <p className="text-sm text-text-muted">
            Requests without a valid key will be rejected
          </p>
        </div>
        <Toggle
          checked={requireApiKey}
          onChange={() => onRequireApiKeyChange(!requireApiKey)}
        />
      </div>

      {/* Security warning when endpoint exposed without API key on remote host */}
      {isRemoteHost && !requireApiKey && (
        <div className="mb-4 -mt-2">
          <SecurityWarning message="Endpoint is exposed without an API key." />
        </div>
      )}

      {keyActionStatus && (
        <StatusAlert status={keyActionStatus} className="mb-4" />
      )}

      {keys.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <span className="material-symbols-outlined text-[32px]">
              vpn_key
            </span>
          </div>
          <p className="text-text-main font-medium mb-1">No API keys yet</p>
          <p className="text-sm text-text-muted mb-4">
            Create your first API key to get started
          </p>
          <Button icon="add" onClick={onCreateClick}>
            Create Key
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          {keys.map((key) => {
            const limitView = formatLimitState(key);
            const isSavingThisKey = savingKeyId === key.id;

            return (
              <div
                key={key.id}
                className={`py-4 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="group flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{key.name}</p>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${getLimitBadgeClass(limitView.status)}`}
                      >
                        {limitView.status}
                      </span>
                      {key.isActive === false && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500">
                          paused
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs text-text-muted font-mono break-all">
                        {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                      </code>
                      <button
                        onClick={() => onToggleVisibility(key.id)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                        aria-label={visibleKeys.has(key.id) ? "Hide API key" : "Show API key"}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                      <button
                        onClick={() => onCopy(key.key, key.id)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        aria-label="Copy API key"
                        title="Copy key"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === key.id ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>

                    <p className="text-xs text-text-muted mt-2">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </p>

                    <div className="mt-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-text-main">
                            Budget: {limitView.summary}
                          </p>
                          {limitView.remaining && (
                            <p className="text-xs text-text-muted mt-1">
                              {limitView.remaining}
                            </p>
                          )}
                        </div>
                        <Link href="/dashboard/key-budgets">
                          <Button size="sm" variant="ghost" icon="account_balance_wallet">
                            Manage Budget
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="edit"
                      onClick={() => onEditKey(key)}
                    >
                      Edit
                    </Button>
                    <Toggle
                      size="sm"
                      checked={key.isActive ?? true}
                      disabled={isSavingThisKey}
                      onChange={(checked) => {
                        if (key.isActive && !checked) onPauseKey(key, checked);
                        else onToggleKey(key.id, checked);
                      }}
                      title={key.isActive ? "Pause key" : "Resume key"}
                    />
                    <button
                      onClick={() => onDeleteKey(key.id)}
                      className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                      aria-label="Delete API key"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        delete
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

ApiKeysCard.propTypes = {
  keys: PropTypes.arrayOf(PropTypes.object).isRequired,
  copied: PropTypes.string,
  requireApiKey: PropTypes.bool.isRequired,
  isRemoteHost: PropTypes.bool,
  keyActionStatus: PropTypes.object,
  visibleKeys: PropTypes.instanceOf(Set).isRequired,
  savingKeyId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onCreateClick: PropTypes.func.isRequired,
  onRequireApiKeyChange: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
  onToggleVisibility: PropTypes.func.isRequired,
  onEditKey: PropTypes.func.isRequired,
  onPauseKey: PropTypes.func.isRequired,
  onToggleKey: PropTypes.func.isRequired,
  onDeleteKey: PropTypes.func.isRequired,
  maskKey: PropTypes.func.isRequired,
};

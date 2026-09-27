"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Toggle, Tooltip, ErrorReason } from "@/shared/components";
import { describeProviderError } from "@/shared/utils/errorReason";
import { translate } from "@/i18n/runtime";
import CooldownTimer from "./CooldownTimer";
import CircuitBreakerBadge from "../components/CircuitBreakerBadge";

export default function ConnectionRow({ connection, affectedCombos = [], proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null, circuitBreaker = null, onResetCircuit = null, onCatalogSynced = null, canSyncCatalog = false }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  const catalog = connection.modelCatalog;
  const catalogModels = catalog?.models || [];
  const countByTier = (tier) => catalogModels.filter((m) => m.availability !== "unavailable" && m.tier === tier).length;
  const freeCount = countByTier("free");
  const creditsCount = countByTier("credits");
  const paidCount = countByTier("paid");
  const unknownCount = countByTier("unknown");
  const availableCount = catalogModels.filter((m) => m.availability !== "unavailable").length;
  const unavailableModels = catalogModels.filter((m) => m.availability === "unavailable");
  const pendingModels = catalogModels.filter((m) => m.availability === "temporarily-absent");
  const curatedHasWarning = catalogModels.some((m) => m.tierSource === "curated");
  const status = !catalog ? "never-synced"
    : catalog.lastError && !catalog.lastSuccessAt ? "error"
    : catalog.lastError ? "stale"
    : !catalog.lastSuccessAt ? "never-synced"
    : "ok";
  const catalogErrorReason = catalog?.lastError ? describeProviderError(catalog.lastError) : null;
  const catalogErrorTitle = catalogErrorReason?.title ? translate(catalogErrorReason.title) : null;
  const stale = (() => {
    const ts = Date.parse(catalog?.lastSuccessAt || "");
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > 26 * 60 * 60 * 1000;
  })();
  const formatSyncDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  const [showCatalogDetails, setShowCatalogDetails] = useState(false);
  const [tierFilter, setTierFilter] = useState("all");
  const filteredForDetails = (() => {
    if (tierFilter === "all") return catalogModels.filter((m) => m.availability !== "unavailable");
    return catalogModels.filter((m) => m.availability !== "unavailable" && m.tier === tierFilter);
  })();
  const syncModels = async () => {
    if (!canSyncCatalog) return;
    setSyncingModels(true);
    setCatalogMessage("");
    try {
      const response = await fetch(`/api/providers/${connection.id}/model-catalog`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.skipped) setCatalogMessage("This provider does not publish a model list.");
      else if (data.error) setCatalogMessage(data.error);
      else {
        const available = data.available ?? data.counts?.available ?? 0;
        setCatalogMessage(`Catalog updated — ${available} model${available === 1 ? "" : "s"} discovered. Use Import models to add them to Available Models.`);
        if (typeof onCatalogSynced === "function") await onCatalogSynced(data.catalog || null);
      }
    } catch {
      setCatalogMessage("Could not update the model catalog.");
    } finally {
      setSyncingModels(false);
    }
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        {/* Priority arrows */}
        <div className="flex shrink-0 flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm pointer-coarse:text-[20px]">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm pointer-coarse:text-[20px]">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
          {authIcon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <CircuitBreakerBadge status={circuitBreaker} onReset={onResetCircuit} />
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <ErrorReason
                error={connection.lastError}
                status={connection.errorCode ?? connection.lastErrorCode}
                compact
                className="max-w-full text-xs sm:max-w-[300px]"
              />
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
            {catalog && (
              <>
                <Badge
                  variant={status === "error" || status === "stale" ? "error" : status === "ok" ? "success" : "default"}
                  size="sm"
                  title={status === "error" ? `Sync failed: ${catalogErrorTitle || catalog.lastError || "unknown error"}` : `Last sync: ${formatSyncDate(catalog.lastSuccessAt)}`}
                >
                  {status === "never-synced" ? "Not yet synced" : status === "error" ? "Sync failed" : status === "stale" ? "Stale" : `${availableCount} models`}
                </Badge>
                {catalog.lastSuccessAt && <span className="text-[11px] text-text-muted">Updated {formatSyncDate(catalog.lastSuccessAt)}</span>}
                {stale && status === "ok" && <span className="text-[11px] text-amber-600 dark:text-amber-400">Catalog outdated — update now</span>}
                {curatedHasWarning && <span className="text-[11px] text-amber-600 dark:text-amber-400" title="Some models rely on curated rules and pricing may change">Curated rule</span>}
              </>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
          {catalog && status !== "never-synced" && status !== "error" && (freeCount + creditsCount + paidCount + unknownCount) > 0 && (
            <div
              className="mt-1 flex flex-wrap items-center gap-1"
              title="Pricing tier of each discovered model — not your account balance"
              aria-label={`Model pricing tiers: ${freeCount} free, ${creditsCount} per-request, ${paidCount} paid, ${unknownCount} unknown`}
            >
              {freeCount > 0 && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">{freeCount} free</span>}
              {creditsCount > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" title="Models billed per request (e.g. image), not token-priced">{creditsCount} per-req</span>}
              {paidCount > 0 && <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">{paidCount} paid</span>}
              {unknownCount > 0 && <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[11px] text-text-muted">{unknownCount} unknown price</span>}
            </div>
          )}
          {catalog && unavailableModels.length > 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {unavailableModels.length} saved model{unavailableModels.length === 1 ? " is" : "s are"} unavailable and will be skipped by combos. Stored combos are unchanged — remove or replace members only when you confirm it below.
              {(affectedCombos || []).length > 0 && ` Affected combos: ${(affectedCombos || []).join(", ")}.`}
            </p>
          )}
          {catalog && pendingModels.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
              {pendingModels.length} model{pendingModels.length === 1 ? "" : "s"} temporarily absent — still listed, hidden after one more confirmed sync without {pendingModels.length === 1 ? "it" : "them"}.
            </p>
          )}
          {catalog && status !== "never-synced" && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setShowCatalogDetails((v) => !v)}
                aria-expanded={showCatalogDetails}
                className="text-xs text-text-muted underline underline-offset-2 hover:text-primary"
              >
                {showCatalogDetails ? "Hide model list" : `Show model list (${availableCount})`}
              </button>
              {showCatalogDetails && (
                <div className="mt-1 rounded-lg border border-border p-2">
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter models by pricing tier">
                    {[["all", "All"], ["free", "Free"], ["credits", "Per-request"], ["paid", "Paid"], ["unknown", "Unknown"]].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTierFilter(value)}
                        aria-pressed={tierFilter === value}
                        className={`rounded px-2 py-0.5 text-[11px] ${tierFilter === value ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {curatedHasWarning && (
                    <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      Some models rely on curated rules and pricing may change.
                    </p>
                  )}
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                    {filteredForDetails.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="min-w-0 truncate" title={m.name || m.id}>{m.name || m.id}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-muted">
                          {m.pricing && (m.pricing.prompt !== null || m.pricing.completion !== null) && (
                            <span title={`prompt ${m.pricing.prompt ?? "?"} / completion ${m.pricing.completion ?? "?"}`}>
                              {m.pricing.prompt ?? "?"} / {m.pricing.completion ?? "?"}
                            </span>
                          )}
                          <span className={`rounded px-1 py-px ${m.tier === "free" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : m.tier === "credits" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : m.tier === "paid" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-zinc-500/10"}`}>
                            {m.tier === "credits" ? "per-req" : (m.tier || "unknown")}
                          </span>
                        </span>
                      </li>
                    ))}
                    {filteredForDetails.length === 0 && <li className="text-text-muted">No models in this tier.</li>}
                  </ul>
                  {unavailableModels.length > 0 && (
                    <div className="mt-1 border-t border-border pt-1">
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Unavailable — kept in saved combos, skipped at runtime:</p>
                      <ul className="mt-0.5 space-y-0.5 text-[11px] text-text-muted">
                        {unavailableModels.map((m) => (
                          <li key={m.id} className="truncate" title={m.name || m.id}>{m.name || m.id}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {catalog && status === "error" && (
            <div className="mt-1 flex flex-wrap items-start gap-1 text-xs text-red-500">
              <span>Last sync failed{syncingModels ? " — retrying…" : ":"}</span>
              {!syncingModels && <ErrorReason error={catalog.lastError} compact className="text-xs" />}
              <span>Previous model list kept.</span>
            </div>
          )}
          {catalogMessage && <p className="mt-1 text-xs text-text-muted" role="status" aria-live="polite">{catalogMessage}</p>}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={() => autoPing.onToggle(!autoPing.on)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPing.on ? "text-primary" : "text-text-muted hover:text-primary"}`}
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                <span className="text-[10px] leading-tight">Auto-ping</span>
              </button>
            </Tooltip>
          )}
          {canSyncCatalog && (
            <button
              type="button"
              onClick={syncModels}
              disabled={syncingModels}
              className="flex w-full flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
              title="Refresh this account's discovered catalog. Does not add models to Available Models — use Import models there."
            >
              <span className={`material-symbols-outlined text-[18px]${syncingModels ? " animate-spin" : ""}`}>{syncingModels ? "progress_activity" : "sync"}</span>
              <span className="text-[10px] leading-tight">Sync</span>
            </button>
          )}
          <button onClick={onEdit} className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  affectedCombos: PropTypes.arrayOf(PropTypes.string),
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onCatalogSynced: PropTypes.func,
  canSyncCatalog: PropTypes.bool,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
  circuitBreaker: PropTypes.shape({
    name: PropTypes.string,
    state: PropTypes.string,
    retryAfterMs: PropTypes.number,
  }),
  onResetCircuit: PropTypes.func,
};

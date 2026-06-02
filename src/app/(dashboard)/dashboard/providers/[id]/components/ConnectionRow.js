"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Badge, Toggle } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";

function parseValidExpiresAt(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatVietnameseExpiresAt(value) {
  const timestamp = parseValidExpiresAt(value);
  if (!timestamp) return null;

  const formatter = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.hour}:${byType.minute}:${byType.second} ${byType.day}-${byType.month}-${byType.year}`;
}

function formatRemainingExpiresAt(value) {
  const timestamp = parseValidExpiresAt(value);
  if (!timestamp) return null;

  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return "0m";

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(diffMs / 3600000);
  const totalDays = Math.floor(diffMs / 86400000);

  if (totalDays >= 1) {
    const remainingHours = Math.floor((diffMs % 86400000) / 3600000);
    return remainingHours > 0
      ? `${totalDays}d${remainingHours}h`
      : `${totalDays}d`;
  }
  if (totalHours >= 1) {
    const remainingMinutes = Math.floor((diffMs % 3600000) / 60000);
    return remainingMinutes > 0
      ? `${totalHours}h${remainingMinutes}m`
      : `${totalHours}h`;
  }
  return `${Math.max(1, totalMinutes)}m`;
}

export default function ConnectionRow({
  index,
  connection,
  proxyPools,
  isOAuth,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggleActive,
  onUpdateProxy,
  onEdit,
  onDelete,
  oneByOneStatus = null,
  manualRefreshStatus = null,
  disablePriorityControls = false,
  isSelected = false,
  onSelectChange = null,
  onWarmup = null,
  warmupStatus = null,
}) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [showWarmupDropdown, setShowWarmupDropdown] = useState(false);
  const proxyDropdownRef = useRef(null);
  const warmupDropdownRef = useRef(null);

  const proxyPoolMap = new Map(
    (proxyPools || []).map((pool) => [pool.id, pool]),
  );
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId
    ? proxyPoolMap.get(boundProxyPoolId)
    : null;
  const hasLegacyProxy =
    connection.providerSpecificData?.connectionProxyEnabled === true &&
    !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";

  let maskedProxyUrl = "";
  if (
    boundProxyPool?.proxyUrl ||
    connection.providerSpecificData?.connectionProxyUrl
  ) {
    const rawProxyUrl =
      boundProxyPool?.proxyUrl ||
      connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText =
    boundProxyPool?.noProxy ||
    connection.providerSpecificData?.connectionNoProxy ||
    "";

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
      if (
        proxyDropdownRef.current &&
        !proxyDropdownRef.current.contains(e.target)
      ) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  // Close warmup dropdown when clicking outside
  useEffect(() => {
    if (!showWarmupDropdown) return;
    const handler = (e) => {
      if (
        warmupDropdownRef.current &&
        !warmupDropdownRef.current.contains(e.target)
      ) {
        setShowWarmupDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWarmupDropdown]);

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
  const authIcon = isCookieConnection
    ? "cookie"
    : isOAuthConnection
      ? "lock"
      : "key";
  const authLabel = isOAuthConnection
    ? "OAuth"
    : isCookieConnection
      ? "Cookie"
      : "API Key";
  const isEmail = (v) =>
    typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const displayName = isOAuthConnection
    ? isEmail(connection.email)
      ? connection.email
      : isEmail(connection.name)
        ? connection.name
        : connection.name ||
          connection.email ||
          connection.displayName ||
          "OAuth Account"
    : connection.name ||
      connection.email ||
      connection.displayName ||
      "API Key";
  const formattedExpiresAt = formatVietnameseExpiresAt(connection.expiresAt);
  const remainingExpiresAt = formatRemainingExpiresAt(connection.expiresAt);

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil =
    Object.entries(connection)
      .filter(([k]) => k.startsWith("modelLock_"))
      .map(([, v]) => v)
      .filter((v) => !!v)
      .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until =
        Object.entries(connection)
          .filter(([k]) => k.startsWith("modelLock_"))
          .map(([, v]) => v)
          .filter((v) => v && new Date(v).getTime() > Date.now())
          .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus =
    connection.testStatus === "unavailable" && !isCooldown
      ? "active" // Cooldown expired u2192 treat as active
      : connection.testStatus;

  const getStatusVariant = () => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success")
      return "success";
    if (
      effectiveStatus === "error" ||
      effectiveStatus === "expired" ||
      effectiveStatus === "unavailable"
    )
      return "error";
    return "default";
  };

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
    if (oneByOneStatus.state === "failed")
      return oneByOneStatus.error
        ? `failed: ${oneByOneStatus.error}`
        : "failed";
    return null;
  };

  const getManualRefreshVariant = () => {
    if (!manualRefreshStatus) return "default";
    if (manualRefreshStatus.state === "success") return "success";
    if (manualRefreshStatus.state === "failed") return "error";
    if (manualRefreshStatus.state === "refreshing") return "primary";
    return "default";
  };

  const getManualRefreshLabel = () => {
    if (!manualRefreshStatus) return null;
    if (manualRefreshStatus.state === "refreshing") return "refreshing";
    if (manualRefreshStatus.state === "success") return "refreshed";
    if (manualRefreshStatus.state === "failed")
      return manualRefreshStatus.error
        ? `refresh failed: ${manualRefreshStatus.error}`
        : "refresh failed";
    return null;
  };

  return (
    <div
      className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        {/* Row Number (STT) */}
        {index !== undefined && (
          <span
            className="shrink-0 text-xs font-mono font-semibold text-text-muted/60 min-w-[20px] text-center"
            title={`Row #${index + 1}`}
          >
            {index + 1}
          </span>
        )}
        {/* Priority arrows */}
        <div className="flex shrink-0 flex-col">
          <label className="mb-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => {
                onSelectChange?.(e.target.checked, e.shiftKey);
              }}
              onChange={() => {}}
              className="rounded border-border"
              title="Select this account for batch actions"
            />
          </label>
          <button
            onClick={onMoveUp}
            disabled={disablePriorityControls || isFirst}
            className={`p-0.5 rounded ${disablePriorityControls || isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">
              keyboard_arrow_up
            </span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={disablePriorityControls || isLast}
            className={`p-0.5 rounded ${disablePriorityControls || isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">
              keyboard_arrow_down
            </span>
          </button>
        </div>
        <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
          {authIcon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {formattedExpiresAt && (
            <div className="mt-1 text-xs text-text-muted">
              Expire at: {formattedExpiresAt}
              {remainingExpiresAt ? ` (${remainingExpiresAt})` : ""}
            </div>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false
                ? "disabled"
                : effectiveStatus || "Unknown"}
            </Badge>
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {connection.warmedUp === true && (
              <Badge variant="success" size="sm" title={connection.warmedUpAt ? `Warmed up at: ${formatVietnameseExpiresAt(connection.warmedUpAt)}` : "Warmed up"}>
                Warmed
              </Badge>
            )}
            {warmupStatus?.state === "refreshing" && (
              <Badge variant="primary" size="sm">
                Warming...
              </Badge>
            )}
            {warmupStatus?.state === "failed" && (
              <Badge variant="error" size="sm" title={warmupStatus.error}>
                Warmup failed
              </Badge>
            )}
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && (
              <CooldownTimer until={modelLockUntil} />
            )}
            {connection.lastError && connection.isActive !== false && (
              <span
                className="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]"
                title={connection.lastError}
              >
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">
              #{connection.priority}
            </span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">
                Auto: {connection.globalPriority}
              </span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
            {getManualRefreshLabel() && (
              <Badge variant={getManualRefreshVariant()} size="sm">
                {getManualRefreshLabel()}
              </Badge>
            )}
            {connection.providerSpecificData?.autoRefreshEnabled === true && (
              <Badge variant="default" size="sm">
                auto refresh
              </Badge>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span
                className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]"
                title={proxyDisplayText}
              >
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span
                  className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]"
                  title={noProxyText}
                >
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {/* Proxy button with inline dropdown */}
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
          <div ref={warmupDropdownRef} className="relative">
            <button
              onClick={() => {
                if (warmupStatus?.state !== "refreshing") {
                  setShowWarmupDropdown((prev) => !prev);
                }
              }}
              disabled={warmupStatus?.state === "refreshing"}
              className={`flex flex-col items-center rounded px-2 py-1 ${warmupStatus?.state === "refreshing" ? "text-text-muted/30 cursor-not-allowed" : "text-orange-500 hover:bg-orange-500/10 hover:text-orange-600"}`}
              title="Warmup account"
            >
              <span className="material-symbols-outlined text-[18px]">
                {warmupStatus?.state === "refreshing" ? "progress_activity" : "local_fire_department"}
              </span>
              <span className="text-[10px] leading-tight">Warmup</span>
            </button>
            {showWarmupDropdown && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                <button
                  onClick={() => {
                    onWarmup({ intensity: "light" });
                    setShowWarmupDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-main flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px] text-green-500">bolt</span>
                  Light (1 token)
                </button>
                <button
                  onClick={() => {
                    onWarmup({ intensity: "medium" });
                    setShowWarmupDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-main flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px] text-orange-500">local_fire_department</span>
                  Medium (~500 tokens)
                </button>
                <button
                  onClick={() => {
                    if (confirm("WARNING: Heavy warmup will consume ~2,000 tokens of your actual quota and may cost money. Proceed?")) {
                      onWarmup({ intensity: "heavy" });
                    }
                    setShowWarmupDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-main flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px] text-red-500">warning</span>
                  Heavy (~2,000 tokens)
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onEdit}
            className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button
            onClick={onDelete}
            className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10"
          >
            <span className="material-symbols-outlined text-[18px]">
              delete
            </span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={
            (connection.isActive ?? true)
              ? "Disable connection"
              : "Enable connection"
          }
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  index: PropTypes.number,
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
  proxyPools: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      proxyUrl: PropTypes.string,
      noProxy: PropTypes.string,
      isActive: PropTypes.bool,
    }),
  ),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  manualRefreshStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  disablePriorityControls: PropTypes.bool,
  isSelected: PropTypes.bool,
  onSelectChange: PropTypes.func,
  onWarmup: PropTypes.func,
  warmupStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
};

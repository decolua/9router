"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Badge, Toggle } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  // Support both legacy single proxyPoolId and new proxyPoolIds array
  const boundProxyPoolIds = connection.providerSpecificData?.proxyPoolIds ||
    (connection.providerSpecificData?.proxyPoolId ? [connection.providerSpecificData.proxyPoolId] : []);
  const boundProxyPools = boundProxyPoolIds.map(id => proxyPoolMap.get(id)).filter(Boolean);
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = boundProxyPoolIds.length > 0 || hasLegacyProxy;
  const proxyDisplayText = boundProxyPools.length > 0
    ? boundProxyPools.length === 1
      ? `Pool: ${boundProxyPools[0].name}`
      : `${boundProxyPools.length} pools`
    : hasLegacyProxy
      ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
      : "";

  // Show first active pool's URL as hint (round-robin means any could be active)
  let maskedProxyUrl = "";
  const firstActivePool = boundProxyPools.find(p => p.isActive === true) || boundProxyPools[0];
  if (firstActivePool?.proxyUrl) {
    try {
      const parsed = new URL(firstActivePool.proxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = firstActivePool.proxyUrl;
    }
  } else if (connection.providerSpecificData?.connectionProxyUrl) {
    maskedProxyUrl = connection.providerSpecificData.connectionProxyUrl;
  }

  const noProxyText = firstActivePool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPools.some(p => p.isActive === true)) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolIds.length > 0 || hasLegacyProxy) {
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

  const handleToggleProxy = async (poolId, checked) => {
    const current = boundProxyPoolIds;
    let next;
    if (checked) {
      next = [...current, poolId];
    } else {
      next = current.filter(id => id !== poolId);
    }
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(next.length > 0 ? next : null);
    } finally {
      setUpdatingProxy(false);
    }
  };

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name || connection.nodeName || "API Key";
  const showNodeName = connection.nodeName && connection.name !== connection.nodeName;

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

  const getStatusVariant = () => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
    return "default";
  };

  return (
    <div className={`group flex items-center justify-between p-2 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Priority arrows */}
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-text-muted">
          {isOAuth ? "lock" : "key"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {showNodeName && (
            <Badge variant="secondary" size="sm" className="mt-1">
              {connection.nodeName}
            </Badge>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-text-muted truncate max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-text-muted">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="text-[11px] text-text-muted truncate max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
                  <button
                    onClick={() => onUpdateProxy(null)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolIds.length === 0 ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  <div className="h-px bg-border mx-2 my-1" />
                  {(proxyPools || []).map((pool) => {
                    const isChecked = boundProxyPoolIds.includes(pool.id);
                    return (
                      <label
                        key={pool.id}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleToggleProxy(pool.id, e.target.checked)}
                          className="checkbox checkbox-sm checkbox-primary"
                        />
                        <span className={isChecked ? "font-medium" : ""}>{pool.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button onClick={onEdit} className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="flex flex-col items-center px-2 py-1 rounded hover:bg-red-500/10 text-red-500">
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
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};


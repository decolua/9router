"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import CooldownTimer from "./CooldownTimer";

function StatusBadge({ variant, children }) {
  if (variant === "success") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
        {children}
      </Badge>
    );
  }
  if (variant === "error") {
    return <Badge variant="destructive">{children}</Badge>;
  }
  return <Badge variant="secondary">{children}</Badge>;
}

export default function ConnectionRow({
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
}) {
  const [updatingProxy, setUpdatingProxy] = useState(false);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
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
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
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
    boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
    }
  };

  const displayName = isOAuth
    ? connection.name ||
      connection.email ||
      connection.displayName ||
      "OAuth Account"
    : connection.name;

  const [isCooldown, setIsCooldown] = useState(false);

  const modelLockUntil =
    Object.entries(connection)
      .filter(([k]) => k.startsWith("modelLock_"))
      .map(([, v]) => v)
      .filter(Boolean)
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
  }, [connection, modelLockUntil]);

  const effectiveStatus =
    connection.testStatus === "unavailable" && !isCooldown
      ? "active"
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

  const sv = getStatusVariant();

  return (
    <div
      className={cn(
        "group flex items-center justify-between rounded-lg p-2 transition-colors",
        "hover:bg-muted/50",
        connection.isActive === false && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className={cn(
              "rounded p-0.5",
              isFirst
                ? "cursor-not-allowed text-muted-foreground/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="material-symbols-outlined text-sm">
              keyboard_arrow_up
            </span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className={cn(
              "rounded p-0.5",
              isLast
                ? "cursor-not-allowed text-muted-foreground/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="material-symbols-outlined text-sm">
              keyboard_arrow_down
            </span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-muted-foreground">
          {isOAuth ? "lock" : "key"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge variant={sv}>
              {connection.isActive === false
                ? "disabled"
                : effectiveStatus || "Unknown"}
            </StatusBadge>
            {hasAnyProxy && (
              <StatusBadge variant={proxyBadgeVariant}>Proxy</StatusBadge>
            )}
            {isCooldown && connection.isActive !== false && (
              <CooldownTimer until={modelLockUntil} />
            )}
            {connection.lastError && connection.isActive !== false && (
              <span
                className="max-w-[300px] truncate text-xs text-destructive"
                title={connection.lastError}
              >
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              #{connection.priority}
            </span>
            {connection.globalPriority && (
              <span className="text-xs text-muted-foreground">
                Auto: {connection.globalPriority}
              </span>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className="max-w-[420px] truncate text-[11px] text-muted-foreground"
                title={proxyDisplayText}
              >
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span
                  className="max-w-[320px] truncate text-[11px] text-muted-foreground"
                  title={noProxyText}
                >
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex gap-1">
          {(proxyPools || []).length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "flex flex-col items-center rounded-md px-2 py-1 outline-none transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  hasAnyProxy ? "text-primary" : "text-muted-foreground",
                )}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem
                  onClick={() => handleSelectProxy("__none__")}
                  className={
                    !boundProxyPoolId ? "font-medium text-primary" : undefined
                  }
                >
                  None
                </DropdownMenuItem>
                {(proxyPools || []).map((pool) => (
                  <DropdownMenuItem
                    key={pool.id}
                    onClick={() => handleSelectProxy(pool.id)}
                    className={
                      boundProxyPoolId === pool.id
                        ? "font-medium text-primary"
                        : undefined
                    }
                  >
                    {pool.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto flex-col gap-0 px-2 py-1 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto flex-col gap-0 px-2 py-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </Button>
        </div>
        <Switch
          size="sm"
          checked={connection.isActive ?? true}
          onCheckedChange={onToggleActive}
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
};

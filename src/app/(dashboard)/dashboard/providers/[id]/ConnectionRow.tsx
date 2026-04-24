"use client";

import React, { useState, useEffect } from "react";
import { 
  Lock, 
  Key, 
  CaretUp, 
  CaretDown, 
  DotsThreeVertical,
  Gear,
  Trash
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import CooldownTimer from "./CooldownTimer";

interface Connection {
  id: string;
  provider: string;
  authType: string;
  isActive: boolean;
  testStatus: string;
  priority: number;
  name?: string;
  email?: string;
  displayName?: string;
  lastError?: string;
  providerSpecificData?: {
    proxyPoolId?: string | null;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface ProxyPool {
  id: string;
  name: string;
}

interface ConnectionRowProps {
  connection: Connection;
  proxyPools: ProxyPool[];
  isOAuth: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function StatusBadge({ variant, children }: { variant: "success" | "error" | "default", children: React.ReactNode }) {
  if (variant === "success") {
    return (
      <Badge className="border-primary/20 bg-primary/10 text-primary dark:text-primary px-1.5 py-0 rounded-none h-4 border-none">
        {children}
      </Badge>
    );
  }
  if (variant === "error") {
    return <Badge variant="destructive" className="px-1.5 py-0 rounded-none h-4 border-none">{children}</Badge>;
  }
  return <Badge variant="secondary" className="px-1.5 py-0 rounded-none h-4 border-none">{children}</Badge>;
}

export default function ConnectionRow({
  connection,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  proxyPools,
  isOAuth,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: ConnectionRowProps) {
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const [isCooldown, setIsCooldown] = useState(false);

  const modelLockUntil =
    Object.entries(connection)
      .filter(([k]) => k.startsWith("modelLock_"))
      .map(([, v]) => v as string)
      .filter(Boolean)
      .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until =
        Object.entries(connection)
          .filter(([k]) => k.startsWith("modelLock_"))
          .map(([, v]) => v as string)
          .filter((v) => v && new Date(v).getTime() > Date.now())
          .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [connection, modelLockUntil]);

  const effectiveStatus = connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;

  const getStatusVariant = (): "success" | "error" | "default" => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
    return "default";
  };

  const sv = getStatusVariant();

  return (
    <div
      className={cn(
        "group flex items-center justify-between rounded-none p-1.5 transition-colors",
        "hover:bg-muted/30",
        connection.isActive === false && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className={cn(
              "rounded-none p-0.5",
              isFirst ? "cursor-not-allowed text-muted-foreground/30" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <CaretUp className="size-3.5" weight="bold" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className={cn(
              "rounded-none p-0.5",
              isLast ? "cursor-not-allowed text-muted-foreground/30" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <CaretDown className="size-3.5" weight="bold" />
          </button>
        </div>
        <div className="size-7 rounded-none bg-muted/20 flex items-center justify-center shrink-0 border border-border/50">
          {isOAuth ? (
            <Lock className="size-4 text-muted-foreground" weight="bold" />
          ) : (
            <Key className="size-4 text-muted-foreground" weight="bold" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold tracking-tight">{displayName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge variant={sv}>
              <span className="text-[10px] font-bold tracking-tight uppercase tabular-nums">
                {connection.isActive === false ? translate("Disabled") : translate(effectiveStatus || "Unknown")}
              </span>
            </StatusBadge>
            {hasAnyProxy && (
              <StatusBadge variant="default">
                <span className="text-[10px] font-bold tracking-tight uppercase tabular-nums">Proxy</span>
              </StatusBadge>
            )}
            {isCooldown && connection.isActive !== false && (
              <CooldownTimer until={modelLockUntil as string} />
            )}
            {connection.lastError && connection.isActive !== false && (
              <span className="max-w-[200px] truncate text-[10px] text-destructive font-medium" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-bold tabular-nums opacity-50 uppercase tracking-widest">
              #{connection.priority}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-7 rounded-none text-muted-foreground hover:text-foreground h-7 w-7"
            )}
          >
            <DotsThreeVertical className="size-5" weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px] rounded-none border-border/50 shadow-none">
            <DropdownMenuItem onClick={onEdit} className="rounded-none text-xs gap-2 py-2 cursor-pointer">
              <Gear className="size-4" weight="bold" />
              {translate("Settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="rounded-none text-xs gap-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
              <Trash className="size-4" weight="bold" />
              {translate("Delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

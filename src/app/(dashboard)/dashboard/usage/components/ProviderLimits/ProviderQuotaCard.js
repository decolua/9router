"use client";

import {
  Loader2,
  MoreVertical,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import ProviderIcon from "@/shared/components/ProviderIcon";
import {
  formatResetTime,
  formatResetTimeDisplay,
  getQuotaRemainingPercent,
} from "./utils";

function ConnectionQuotaRows({ quotas = [] }) {
  if (!quotas?.length) {
    return null;
  }

  return (
    <ul className="divide-y divide-border/50 rounded-md border border-border/50">
      {quotas.map((q, index) => {
        const remaining = getQuotaRemainingPercent(q);
        const countdown = formatResetTime(q.resetAt);
        const resetDisplay = formatResetTimeDisplay(q.resetAt);
        const metaLine = [
          countdown !== "-" ? `Còn ${countdown}` : null,
          resetDisplay,
        ]
          .filter(Boolean)
          .join(" · ");
        const low = remaining < 30;

        return (
          <li key={index} className="flex items-start justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium capitalize leading-tight text-foreground">
                {q.name}
              </p>
              {metaLine ? (
                <p className="mt-px truncate text-[10px] leading-tight text-muted-foreground">
                  {metaLine}
                </p>
              ) : (
                <p className="mt-px text-[10px] text-muted-foreground">—</p>
              )}
            </div>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold tabular-nums leading-none",
                low ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {remaining}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Thẻ một kết nối — header một hàng, quota chỉ số % + meta (không thanh progress).
 */
export default function ProviderQuotaCard({
  connection,
  quota,
  isLoading,
  error,
  isInactive,
  rowBusy,
  isDeleting,
  onRefresh,
  onEdit,
  onDelete,
  onToggleActive,
}) {
  const conn = connection;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/55 bg-card text-card-foreground",
        isInactive && "opacity-60 saturate-75",
      )}
    >
      <header className="flex items-center gap-1.5 border-b border-border/45 px-2 py-1.5">
        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60">
          <ProviderIcon
            src={`/providers/${conn.provider}.png`}
            alt={conn.provider}
            size={22}
            className="object-contain"
            fallbackText={conn.provider?.slice(0, 2).toUpperCase() || "PR"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold capitalize leading-tight">
            {conn.provider}
          </h3>
          {conn.name ? (
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {conn.name}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-px">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isLoading || rowBusy}
            title="Làm mới quota"
            className="text-muted-foreground"
          >
            {isLoading ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RotateCw className="size-3" aria-hidden />
            )}
          </Button>

          <div
            className="flex items-center"
            title={(conn.isActive ?? true) ? "Tắt kết nối" : "Bật kết nối"}
          >
            <Switch
              size="sm"
              checked={conn.isActive ?? true}
              disabled={rowBusy}
              onCheckedChange={onToggleActive}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={rowBusy}
              aria-label="Thao tác kết nối"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "text-muted-foreground",
              )}
            >
              <MoreVertical className="size-3" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-3.5" />
                Sửa kết nối
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2
                  className={cn("size-3.5", isDeleting && "animate-pulse")}
                />
                Xóa kết nối
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="p-1.5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="text-[11px]">Đang tải…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-center">
            <span className="material-symbols-outlined text-lg text-destructive">
              error
            </span>
            <p className="max-w-[18rem] px-1 text-[11px] text-muted-foreground">
              {error}
            </p>
          </div>
        ) : quota?.message ? (
          <div className="rounded-md border border-dashed border-border/55 bg-muted/15 px-2 py-3 text-center">
            <p className="text-[11px] text-muted-foreground">{quota.message}</p>
          </div>
        ) : (
          <ConnectionQuotaRows quotas={quota?.quotas} />
        )}
      </div>
    </article>
  );
}

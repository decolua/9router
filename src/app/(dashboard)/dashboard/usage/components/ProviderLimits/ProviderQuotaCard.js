"use client";

import { Loader2, MoreVertical, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { formatResetTime, getQuotaRemainingPercent } from "./utils";

function QuotaRow({ quota }) {
  const remaining = getQuotaRemainingPercent(quota);
  const countdown = formatResetTime(quota.resetAt);
  const isLow = remaining < 25;
  const isCritical = remaining < 10;

  return (
    <div className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0 border-b border-border/40 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground capitalize">
            {quota.name}
          </span>
          {countdown !== "-" && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              <span>Reset: {countdown}</span>
            </div>
          )}
        </div>
        <div className="flex items-baseline">
          <span className={cn(
            "text-sm font-semibold tabular-nums",
            isCritical ? "text-destructive" : isLow ? "text-amber-500" : "text-foreground"
          )}>
            {remaining}%
          </span>
        </div>
      </div>
      
      <Progress 
        value={remaining} 
        className="h-0.5 bg-muted/20"
        indicatorClassName={cn(
          "transition-all duration-700 ease-out opacity-50",
          isCritical ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary"
        )}
      />
    </div>
  );
}

export default function ProviderQuotaCard({
  connection,
  quota,
  isLoading,
  isSilentRefreshing,
  error,
  isInactive,
  onEdit,
}) {
  const conn = connection;

  return (
    <Card className={cn(
      "shadow-sm border-border/50 overflow-hidden transition-all p-0 bg-transparent hover:bg-muted/10",
      isInactive && "opacity-60 grayscale",
      isSilentRefreshing && "bg-muted/5"
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-background border border-border/50 shadow-sm">
            <ProviderIcon
              src={`/providers/${conn.provider}.png`}
              alt={conn.provider}
              size={18}
              className="object-contain"
            />
          </div>
          <div className="min-w-0 flex flex-col">
            <CardTitle className="text-sm font-medium truncate tracking-tight">
              {conn.name || conn.provider}
            </CardTitle>
            <CardDescription className="text-[11px] text-muted-foreground capitalize">
              {conn.provider}
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7 text-muted-foreground/50 hover:text-foreground rounded-full" />}>
              <MoreVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
               <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => onEdit?.()}>Cài đặt (Settings)</DropdownMenuItem>
               <DropdownMenuItem className="text-destructive text-xs cursor-pointer">Ngắt kết nối</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-3 flex-1">
        {isLoading && !isSilentRefreshing ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground font-medium">Đang tải...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-destructive">
            <AlertCircle className="size-4" />
            <span className="text-xs font-medium">Lỗi kết nối</span>
          </div>
        ) : quota?.quotas?.length ? (
          <div className="space-y-3">
            {quota.quotas.map((q, i) => <QuotaRow key={i} quota={q} />)}
          </div>
        ) : (
          <div className="py-8 text-center opacity-40">
            <span className="text-xs font-medium text-muted-foreground">Không có dữ liệu</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
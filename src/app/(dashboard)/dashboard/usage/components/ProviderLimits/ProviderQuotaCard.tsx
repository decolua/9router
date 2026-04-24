"use client";

import React from "react";
import { 
  Spinner as Loader2, 
  DotsThreeVertical as MoreVertical, 
  WarningCircle as AlertCircle, 
  Clock 
} from "@phosphor-icons/react";
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
import { translate } from "@/i18n/runtime";

interface Quota {
  name: string;
  resetAt: string;
  used: number;
  total: number;
}

interface Connection {
  id: string;
  provider: string;
  name?: string | null;
}

interface ProviderQuotaCardProps {
  connection: Connection;
  quota: { quotas: Quota[] } | null;
  isLoading?: boolean;
  isSilentRefreshing?: boolean;
  error?: string | null;
  isInactive?: boolean;
  onEdit?: () => void;
}

function QuotaRow({ quota }: { quota: Quota }) {
 const remaining = getQuotaRemainingPercent(quota);
 const countdown = formatResetTime(quota.resetAt);
 const isLow = remaining < 25;
 const isCritical = remaining < 10;

 return (
 <div className="flex flex-col gap-1 py-0.5 first:pt-0 last:pb-0 border-b border-border/40 last:border-0">
 <div className="flex items-center justify-between">
 <div className="flex flex-col gap-0.5">
 <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
 {quota.name}
 </span>
 {countdown !== "-" && (
 <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-tighter text-muted-foreground opacity-60">
 <Clock className="size-2.5" weight="bold" />
 <span>Reset: {countdown}</span>
 </div>
 )}
 </div>
 <div className="flex items-baseline">
 <span className={cn(
 "text-xs font-bold tabular-nums",
 isCritical ? "text-destructive" : isLow ? "text-muted-foreground" : "text-foreground"
 )}>
 {remaining}%
 </span>
 </div>
 </div>
 
 <Progress 
 value={remaining} 
 className="h-0.5 bg-muted/20 rounded-none"
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
}: ProviderQuotaCardProps) {
 const conn = connection;

 return (
 <Card className={cn(
 "border-border/50 shadow-none overflow-hidden transition-all p-0 py-0 bg-transparent hover:bg-muted/10 rounded-none h-full",
 isInactive && "opacity-60 grayscale",
 isSilentRefreshing && "bg-muted/5"
 )}>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2 border-b border-border/50 bg-muted/10">
 <div className="flex items-center gap-2.5">
 <div className="flex size-8 items-center justify-center rounded-none bg-background border border-border/50">
 <ProviderIcon
 src={`/providers/${conn.provider}.png`}
 alt={conn.provider}
 size={18}
 className={cn(
 "object-contain",
 (conn.provider === "codex" || conn.provider === "openai" || conn.provider === "github") && "dark:invert"
 )}
 />
 </div>
 <div className="min-w-0 flex flex-col">
 <CardTitle className="text-xs font-bold truncate tracking-tight text-foreground uppercase">
 {conn.name || conn.provider}
 </CardTitle>
 <CardDescription className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">
 {conn.provider}
 </CardDescription>
 </div>
 </div>

 <div className="flex items-center gap-1">
 <DropdownMenu>
 <DropdownMenuTrigger render={
   <Button variant="ghost" size="icon" className="size-7 text-muted-foreground/50 hover:text-foreground rounded-full h-7 w-7">
     <MoreVertical className="size-3.5" weight="bold" />
   </Button>
 } />
 <DropdownMenuContent align="end" className="rounded-none border-border/50 shadow-none bg-background/95 backdrop-blur-md">
 <DropdownMenuItem className="text-xs font-medium cursor-pointer py-2 rounded-none" onClick={() => onEdit?.()}>Settings</DropdownMenuItem>
 <DropdownMenuItem className="text-destructive text-xs font-medium cursor-pointer py-2 rounded-none">Disconnect</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </CardHeader>

 <CardContent className="px-3 pt-1.5 pb-2 flex-1 flex flex-col justify-center">
 {isLoading && !isSilentRefreshing ? (
 <div className="flex flex-col items-center justify-center py-8 gap-3">
 <Loader2 className="size-4 animate-spin text-primary" weight="bold" />
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Syncing...</span>
 </div>
 ) : error ? (
 <div className="flex flex-col items-center justify-center gap-2 py-6 text-destructive">
 <AlertCircle className="size-4" weight="bold" />
 <span className="text-[10px] font-bold uppercase tracking-widest">Connect Fail</span>
 </div>
 ) : quota?.quotas?.length ? (
 <div className="flex flex-col gap-2">
 {quota.quotas.map((q, i) => <QuotaRow key={i} quota={q} />)}
 </div>
 ) : (
 <div className="py-8 text-center opacity-40">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">No Telemetry</span>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

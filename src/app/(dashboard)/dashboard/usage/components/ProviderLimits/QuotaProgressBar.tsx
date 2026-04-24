"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Clock } from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

const formatResetTimeDisplay = (resetTime: string | null) => {
 if (!resetTime) return null;
 try {
 const resetDate = new Date(resetTime);
 if (isNaN(resetDate.getTime())) return null;

 const now = new Date();
 const isToday = resetDate.toDateString() === now.toDateString();
 const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === resetDate.toDateString();

 const timeStr = resetDate.toLocaleTimeString(undefined, {
 hour: "2-digit",
 minute: "2-digit",
 hour12: true,
 });

 if (isToday) return `${translate("Today")}, ${timeStr}`;
 if (isTomorrow) return `${translate("Tomorrow")}, ${timeStr}`;

 return resetDate.toLocaleString(undefined, {
 month: "short",
 day: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 hour12: true,
 });
 } catch {
 return null;
 }
};

interface QuotaProgressBarProps {
  percentage?: number;
  label?: string;
  used?: number;
  total?: number;
  unlimited?: boolean;
  resetTime?: string | null;
}

export default function QuotaProgressBar({
 percentage = 0,
 label = "",
 used = 0,
 total = 0,
 unlimited = false,
 resetTime = null
}: QuotaProgressBarProps) {
 const resetDisplay = formatResetTimeDisplay(resetTime);
 const remaining = percentage;
 const isLow = remaining < 25;
 const isCritical = remaining < 10;

 return (
 <div className="flex flex-col gap-1.5 py-1 group/progress">
 <div className="flex items-center justify-between text-[10px]">
 <div className="flex flex-col gap-0.5">
 <span className="font-bold text-foreground uppercase tracking-widest">
 {label}
 </span>
 {resetDisplay && (
 <div className="flex items-center gap-1 font-bold text-muted-foreground opacity-40 uppercase tracking-tighter">
 <Clock className="size-2.5" weight="bold" />
 <span>Reset: {resetDisplay}</span>
 </div>
 )}
 </div>
 <div className="flex items-center gap-2">
 <span className="text-muted-foreground opacity-40 font-bold tabular-nums uppercase tracking-widest">
 {unlimited ? translate("Unlimited") : `${used.toLocaleString()} / ${total.toLocaleString()}`}
 </span>
 <span className={cn(
 "font-black tabular-nums tracking-tighter",
 isCritical ? "text-destructive" : isLow ? "text-amber-500" : "text-primary"
 )}>
 {unlimited ? "∞" : `${remaining}%`}
 </span>
 </div>
 </div>
 
 {!unlimited && (
 <Progress 
 value={remaining} 
 className="h-1 bg-muted/40 rounded-none"
 indicatorClassName={cn(
 "transition-all duration-700 ease-out",
 isCritical ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary"
 )}
 />
 )}
 </div>
 );
}

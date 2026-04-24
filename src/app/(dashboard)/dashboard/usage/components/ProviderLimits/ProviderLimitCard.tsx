"use client";

import React, { useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import QuotaProgressBar from "./QuotaProgressBar";
import { calculatePercentage } from "./utils";
import { ArrowsClockwise as RefreshCw, WarningCircle as AlertCircle, Info } from "@phosphor-icons/react";

interface Quota {
  name: string;
  used: number;
  total: number;
  remainingPercentage?: number;
  resetAt?: string;
}

interface ProviderLimitCardProps {
  provider: string;
  name?: string;
  plan?: string;
  quotas?: Quota[];
  message?: string | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => Promise<void>;
}

const planVariants: Record<string, "default" | "secondary" | "outline"> = {
 free: "default",
 pro: "secondary",
 ultra: "secondary",
 enterprise: "outline",
};

export default function ProviderLimitCard({
 provider,
 name,
 plan,
 quotas = [],
 message = null,
 loading = false,
 error = null,
 onRefresh,
}: ProviderLimitCardProps) {
 const [refreshing, setRefreshing] = useState(false);

 const handleRefresh = async () => {
 if (!onRefresh || refreshing) return;

 setRefreshing(true);
 try {
 await onRefresh();
 } finally {
 setRefreshing(false);
 }
 };

 // Get provider info from config
 const getProviderColor = () => {
 const colors: Record<string, string> = {
 github: "#000000",
 antigravity: "#4285F4",
 codex: "#10A37F",
 kiro: "#FF9900",
 claude: "#D97757",
 };
 return colors[provider?.toLowerCase()] || "#6B7280";
 };

 const providerColor = getProviderColor();
 const planVariant = planVariants[plan?.toLowerCase() || ""] || "default";

 return (
 <Card className="flex flex-col gap-4 p-4 border-border/50 bg-background/50 rounded-none shadow-none h-full">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 {/* Provider Logo */}
 <div
 className="size-9 rounded-none flex items-center justify-center p-1.5 border border-border/50"
 style={{ backgroundColor: `${providerColor}15` }}
 >
 <ProviderIcon
 src={`/providers/${provider}.png`}
 alt={provider || "Provider"}
 size={32}
 className="object-contain"
 fallbackText={provider?.slice(0, 2).toUpperCase() || "PR"}
 fallbackColor={providerColor}
 />
 </div>

 <div>
 <h3 className="font-bold text-xs tracking-tight text-foreground uppercase">
 {name || provider}
 </h3>
 {plan && (
 <Badge
 variant={planVariant}
 className="h-4 px-1 text-[9px] font-bold uppercase border-none bg-muted/40 rounded-none"
 >
 {plan}
 </Badge>
 )}
 </div>
 </div>

 {/* Refresh Button */}
 <button
 onClick={handleRefresh}
 disabled={refreshing || loading}
 className="p-1.5 rounded-none hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border/50"
 title="Refresh quota"
 >
 <RefreshCw className={`size-3.5 text-muted-foreground ${refreshing || loading ? "animate-spin" : ""}`} weight="bold" />
 </button>
 </div>

 <CardContent className="p-0 flex-1 flex flex-col">
 {/* Loading State */}
 {loading && (
 <div className="space-y-4 py-4 animate-pulse">
 <div className="space-y-2">
 <div className="h-3 bg-muted/40 rounded-none w-1/3"/>
 <div className="h-1.5 bg-muted/40 rounded-none w-full"/>
 </div>
 <div className="space-y-2">
 <div className="h-3 bg-muted/40 rounded-none w-1/4"/>
 <div className="h-1.5 bg-muted/40 rounded-none w-full"/>
 </div>
 </div>
 )}

 {/* Error State */}
 {!loading && error && (
 <div className="p-3 rounded-none bg-destructive/10 border border-destructive/20 mt-2">
 <div className="flex items-start gap-2">
 <AlertCircle className="size-4 text-destructive mt-0.5" weight="bold" />
 <p className="text-[10px] font-bold uppercase tracking-wide text-destructive leading-relaxed">{error}</p>
 </div>
 </div>
 )}

 {/* Info Message (for providers without API) */}
 {!loading && !error && message && (
 <div className="p-3 rounded-none bg-primary/10 border border-primary/20 mt-2">
 <div className="flex items-start gap-2">
 <Info className="size-4 text-primary mt-0.5" weight="bold" />
 <p className="text-[10px] font-bold uppercase tracking-wide text-primary leading-relaxed">
 {message}
 </p>
 </div>
 </div>
 )}

 {/* Quota Progress Bars */}
 {!loading && !error && !message && quotas?.length > 0 && (
 <div className="space-y-4 pt-2">
 {quotas.map((quota, index) => {
 // For Antigravity, use remainingPercentage if available, otherwise calculate
 const percentage =
 quota.remainingPercentage !== undefined
 ? Math.round(((quota.total - quota.used) / quota.total) * 100)
 : calculatePercentage(quota.used, quota.total);
 const unlimited = quota.total === 0 || quota.total === null;

 return (
 <QuotaProgressBar
 key={`${quota.name}-${index}`}
 label={quota.name}
 used={quota.used}
 total={quota.total}
 percentage={percentage}
 unlimited={unlimited}
 resetTime={quota.resetAt || null}
 />
 );
 })}
 </div>
 )}

 {/* Empty State */}
 {!loading && !error && !message && quotas?.length === 0 && (
 <div className="flex-1 flex flex-col items-center justify-center py-8 text-center opacity-30 gap-2">
 <RefreshCw className="size-8" weight="bold" />
 <p className="text-[10px] font-bold uppercase tracking-widest">Awaiting Pulse</p>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

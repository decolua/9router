"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a hover popover for details and cooldown clearing.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
 CheckCircle, 
 WarningCircle, 
 Warning, 
 Question, 
 ArrowsClockwise as RefreshCw,
 Clock
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/lib/utils";

interface AvailabilityModel {
  provider: string;
  model: string;
  status: 'available' | 'cooldown' | 'unavailable' | 'unknown';
  until?: string;
  connectionId?: string;
  connectionName?: string;
  lastError?: string;
}

interface AvailabilityData {
  models: AvailabilityModel[];
  unavailableCount: number;
}

const STATUS_CONFIG = {
 available: { icon: CheckCircle, color: "text-primary", label: "Available" },
 cooldown: { icon: Clock, color: "text-amber-500", label: "Cooldown" },
 unavailable: { icon: WarningCircle, color: "text-destructive", label: "Unavailable" },
 unknown: { icon: Question, color: "text-muted-foreground", label: "Unknown" },
};

export default function ModelAvailabilityBadge() {
 const [data, setData] = useState<AvailabilityData | null>(null);
 const [loading, setLoading] = useState(true);
 const [expanded, setExpanded] = useState(false);
 const [clearing, setClearing] = useState<string | null>(null);
 const ref = useRef<HTMLDivElement>(null);
 const notify = useNotificationStore();

 const fetchStatus = useCallback(async () => {
 try {
 const res = await fetch("/api/models/availability");
 if (res.ok) {
 const json = await res.json();
 setData(json);
 }
 } catch {
 // silent fail — will retry
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchStatus();
 const interval = setInterval(fetchStatus, 30000);
 return () => clearInterval(interval);
 }, [fetchStatus]);

 // Close popover on outside click
 useEffect(() => {
 const handleClick = (e: MouseEvent) => {
 if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
 };
 if (expanded) document.addEventListener("mousedown", handleClick);
 return () => document.removeEventListener("mousedown", handleClick);
 }, [expanded]);

 const handleClearCooldown = async (provider: string, model: string) => {
 setClearing(`${provider}:${model}`);
 try {
 const res = await fetch("/api/models/availability", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ action: "clearCooldown", provider, model }),
 });
 if (res.ok) {
 notify.success(`Cooldown cleared for ${model}`);
 await fetchStatus();
 } else {
 notify.error("Failed to clear cooldown");
 }
 } catch {
 notify.error("Failed to clear cooldown");
 } finally {
 setClearing(null);
 }
 };

 if (loading) return null;

 const models = data?.models || [];
 const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
 const isHealthy = unavailableCount === 0;

 // Group unhealthy models by provider
 const byProvider: Record<string, AvailabilityModel[]> = {};
 models.forEach((m) => {
 if (m.status === "available") return;
 const key = m.provider || "unknown";
 if (!byProvider[key]) byProvider[key] = [];
 byProvider[key].push(m);
 });

 return (
 <div className="relative" ref={ref}>
 <button
 onClick={() => setExpanded(!expanded)}
 className={cn(
 "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all shadow-none",
 isHealthy
 ? "bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
 : "bg-destructive/5 border-destructive/20 text-destructive hover:bg-destructive/10"
 )}
 >
 {isHealthy ? (
 <CheckCircle className="size-3" weight="bold" />
 ) : (
 <Warning className="size-3" weight="bold" />
 )}
 {isHealthy
 ? "Operational"
 : `${unavailableCount} Issues`}
 </button>

 {expanded && (
 <div className="absolute top-full right-0 mt-2 w-72 bg-background/95 backdrop-blur-md border border-border/40 rounded-xl z-50 overflow-hidden shadow-none">
 <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40 bg-muted/5">
 <div className="flex items-center gap-2">
 {isHealthy ? (
 <CheckCircle className="size-4 text-primary" weight="bold" />
 ) : (
 <WarningCircle className="size-4 text-amber-500" weight="bold" />
 )}
 <span className="text-xs font-bold uppercase tracking-widest text-foreground">Model Status</span>
 </div>
 <button
 onClick={fetchStatus}
 className="p-1 rounded-md hover:bg-muted/10 text-muted-foreground hover:text-foreground transition-colors"
 title="Refresh"
 >
 <RefreshCw className="size-3.5" />
 </button>
 </div>

 <div className="px-3 py-2 max-h-60 overflow-y-auto">
 {isHealthy ? (
 <p className="text-xs text-muted-foreground text-center py-4 font-medium">
 All models are responding normally.
 </p>
 ) : (
 <div className="flex flex-col gap-3 py-1">
 {Object.entries(byProvider).map(([provider, provModels]) => (
 <div key={provider} className="space-y-1.5">
 <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest px-1">{provider}</p>
 <div className="flex flex-col gap-1">
 {provModels.map((m) => {
 const config = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
 const StatusIcon = config.icon;
 const isClearing = clearing === `${m.provider}:${m.model}`;
 return (
 <div
 key={`${m.provider}-${m.model}`}
 className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/5 border border-transparent hover:border-border/40 transition-colors"
 >
 <div className="flex items-center gap-2 min-w-0">
 <StatusIcon
 className={cn("size-3.5 shrink-0", config.color)}
 weight="bold"
 />
 <span className="font-mono text-[10px] text-foreground font-medium truncate">{m.model}</span>
 </div>
 {m.status === "cooldown" && (
 <Button
 size="sm"
 variant="ghost"
 onClick={() => handleClearCooldown(m.provider, m.model)}
 disabled={isClearing}
 className="h-6 px-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/10 hover:text-primary"
 >
 {isClearing ? "..." : "Clear"}
 </Button>
 )}
 </div>
 );
 })}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
}

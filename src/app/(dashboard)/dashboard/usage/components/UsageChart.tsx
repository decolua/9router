"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
 AreaChart,
 Area,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
} from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { translate } from "@/i18n/runtime";

const fmtTokens = (n: number) => {
 if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
 if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
 return String(n || 0);
};

const fmtCost = (n: number) => `$${(n || 0).toFixed(4)}`;

interface ChartData {
  label: string;
  tokens: number;
  cost: number;
}

interface UsageChartProps {
  period?: string;
}

export default function UsageChart({ period = "7d" }: UsageChartProps) {
 const [data, setData] = useState<ChartData[]>([]);
 const [loading, setLoading] = useState(true);
 const [viewMode, setViewMode] = useState<"tokens" | "cost">("tokens");

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const res = await fetch(`/api/usage/chart?period=${period}`);
 if (res.ok) {
 const json = await res.json();
 setData(json);
 }
 } catch (e) {
 console.error("Failed to fetch chart data:", e);
 } finally {
 setLoading(false);
 }
 }, [period]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

 return (
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {translate("Performance Trend")}
 </div>
 <ToggleGroup 
 value={viewMode as any} 
 onValueChange={(v: any) => { 
   const val = Array.isArray(v) ? v[0] : v;
   if (val === "tokens" || val === "cost") setViewMode(val); 
 }}
 size="sm"
 className="bg-muted/30 p-0.5 border border-border/40 rounded-none h-auto"
 >
 <ToggleGroupItem 
 value="tokens" 
 className="h-6 px-3 rounded-none text-[10px] font-bold uppercase tracking-widest data-[state=on]:bg-background data-[state=on]:shadow-none data-[state=on]:text-primary"
 >
 Tokens
 </ToggleGroupItem>
 <ToggleGroupItem 
 value="cost" 
 className="h-6 px-3 rounded-none text-[10px] font-bold uppercase tracking-widest data-[state=on]:bg-background data-[state=on]:shadow-none data-[state=on]:text-primary"
 >
 Cost
 </ToggleGroupItem>
 </ToggleGroup>
 </div>

 <div className="pt-2">
 {loading ? (
 <div className="h-48 flex items-center justify-center text-muted-foreground text-xs font-bold uppercase tracking-widest animate-pulse italic">Loading metrics...</div>
 ) : !hasData ? (
 <div className="h-48 flex items-center justify-center text-muted-foreground text-xs font-bold uppercase tracking-widest opacity-30 italic">{translate("No data available for this period")}</div>
 ) : (
 <ResponsiveContainer width="100%" height={200}>
 <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
 <defs>
 <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
 <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
 </linearGradient>
 <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1} />
 <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
 <XAxis
 dataKey="label"
 tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: "bold" }}
 tickLine={false}
 axisLine={false}
 interval="preserveStartEnd"
 />
 <YAxis
 tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: "bold" }}
 tickLine={false}
 axisLine={false}
 tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
 />
 <Tooltip
 contentStyle={{
 backgroundColor: "hsl(var(--background))",
 border: "1px solid hsl(var(--border))",
 borderRadius: "0px",
 fontSize: "10px",
 fontWeight: "bold",
 boxShadow: "none",
 }}
 itemStyle={{ padding: "0" }}
 formatter={(value: any, name: any) =>
 name === "tokens" ? [fmtTokens(value as number), "Tokens"] : [fmtCost(value as number), "Cost"]
 }
 />
 {viewMode === "tokens" ? (
 <Area
 type="monotone"
 dataKey="tokens"
 stroke="#6366f1"
 strokeWidth={2}
 fill="url(#gradTokens)"
 dot={false}
 activeDot={{ r: 4, strokeWidth: 0 }}
 />
 ) : (
 <Area
 type="monotone"
 dataKey="cost"
 stroke="#f59e0b"
 strokeWidth={2}
 fill="url(#gradCost)"
 dot={false}
 activeDot={{ r: 4, strokeWidth: 0 }}
 />
 )}
 </AreaChart>
 </ResponsiveContainer>
 )}
 </div>
 </div>
 );
}

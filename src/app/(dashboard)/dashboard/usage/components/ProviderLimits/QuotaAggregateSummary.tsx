"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ChartBar as BarChart2, CalendarBlank as Calendar } from "@phosphor-icons/react";

interface AggregateData {
  remainingPct: number;
  sumUsed: number;
  sumTotal: number;
}

interface AggregateRowProps {
  label: string;
  data: AggregateData;
  icon: any;
}

function AggregateRow({ label, data, icon: Icon }: AggregateRowProps) {
 if (!data) return null;

 const isLow = data.remainingPct < 25;
 const isCritical = data.remainingPct < 10;

 return (
 <Card className="border-border/50 bg-background/50 shadow-none py-0 rounded-none h-full">
 <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3 border-b border-border/50 bg-muted/10">
 <div className="flex items-center gap-2">
 <Icon className="size-4 text-muted-foreground opacity-60" weight="bold" />
 <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label} Quota</CardTitle>
 </div>
 <div className="flex flex-col items-end">
 <span className={cn(
 "text-xl font-bold tracking-tight tabular-nums text-foreground",
 isCritical ? "text-destructive" : isLow ? "text-amber-500" : "text-primary"
 )}>
 {data.remainingPct}%
 </span>
 </div>
 </CardHeader>
 <CardContent className="px-4 py-3 flex-1 flex flex-col justify-center">
 <div className="flex flex-col gap-3">
 <Progress 
 value={data.remainingPct} 
 indicatorClassName={cn(
 "transition-all duration-700 ease-out",
 isCritical ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary"
 )}
 className="h-1 bg-muted/40 rounded-none"
 />
 <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">
 <span>Used: <span className="text-foreground tabular-nums opacity-100">{data.sumUsed.toLocaleString()}</span></span>
 <span>Total: <span className="text-foreground tabular-nums opacity-100">{data.sumTotal.toLocaleString()}</span></span>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

interface QuotaAggregateSummaryProps {
  aggregate: {
    kind: string;
    session?: AggregateData;
    weekly?: AggregateData;
  } | null;
}

export default function QuotaAggregateSummary({ aggregate }: QuotaAggregateSummaryProps) {
 if (!aggregate || aggregate.kind === "empty") return null;

 return (
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 {aggregate.session && (
   <AggregateRow 
     label="Session"
     data={aggregate.session} 
     icon={BarChart2} 
   />
 )}
 {aggregate.weekly && (
   <AggregateRow 
     label="Weekly"
     data={aggregate.weekly} 
     icon={Calendar} 
   />
 )}
 </div>
 );
}

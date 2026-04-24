"use client";

import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const fmt = (n: number) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n: number) => `$${(n || 0).toFixed(4)}`;

interface StatCardProps {
  label: string;
  value: string | number;
  valueClass?: string;
}

function StatCard({ label, value, valueClass }: StatCardProps) {
 return (
 <Card className="border-border/50 bg-background/50 shadow-none hover:bg-muted/10 transition-colors rounded-none">
 <CardHeader className="p-3 pb-2 border-b border-border/50 bg-muted/10">
 <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
 {label}
 </span>
 </CardHeader>
 <CardContent className="p-3 pt-3">
 <span className={cn("text-xl font-bold tracking-tight tabular-nums text-foreground", valueClass)}>
 {value}
 </span>
 </CardContent>
 </Card>
 );
}

interface OverviewCardsProps {
  stats: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
  };
}

export default function OverviewCards({ stats }: OverviewCardsProps) {
 return (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <StatCard 
 label="Total Traffic"
 value={fmt(stats.totalRequests)} 
 />
 <StatCard 
 label="Ingress Volume"
 value={fmt(stats.totalPromptTokens)} 
 valueClass="text-primary"
 />
 <StatCard 
 label="Egress Volume"
 value={fmt(stats.totalCompletionTokens)} 
 valueClass="text-primary"
 />
 <StatCard 
 label="Operational Cost"
 value={fmtCost(stats.totalCost)} 
 valueClass="text-muted-foreground"
 />
 </div>
 );
}

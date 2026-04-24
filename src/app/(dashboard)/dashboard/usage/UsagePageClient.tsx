"use client";

import React, { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { 
 ChartLineUp as Pulse, 
 ChartBar as BarChart3, 
 ClockCounterClockwise as History, 
 Lightning as Zap, 
 Key,
 TrendUp as TrendingUp, 
 HardDrives as Server,
 Graph as Network,
 Terminal,
 CaretRight as ChevronRight,
 ShieldCheck,
 ArrowUp,
 ArrowDown,
 SquaresFour as LayoutDashboard,
 Database,
 Cpu
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
 Card, 
 CardContent, 
 CardHeader, 
 CardTitle, 
 CardFooter 
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

import { translate } from "@/i18n/runtime";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ProviderTopology from "./components/ProviderTopology";
import UsageChart from "./components/UsageChart";
import UsageTable, { fmt } from "./components/UsageTable";
import { FREE_PROVIDERS } from "@/shared/constants/providers";

const PERIODS = [
 { value: "24h", label: "24h" },
 { value: "7d", label: "7D" },
 { value: "30d", label: "30D" },
 { value: "60d", label: "60D" },
];

interface ActiveRequest {
  model: string;
  provider: string;
  account: string;
  count: number;
}

interface RecentRequest {
  timestamp: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  status?: string;
}

interface Stats {
  totalRequests: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  errorProvider: string;
  pending?: any;
  byModel?: any;
  byAccount?: any;
  byApiKey?: any;
  byEndpoint?: any;
}

export default function UsagePageClient() {
  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase tracking-tight">
            <Pulse className="size-4" weight="bold"/>
            Giám sát
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-foreground">Usage</h1>
          <p className="text-sm text-muted-foreground font-medium">
            {translate("Monitor infrastructure usage and traffic in real-time.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector />
        </div>
      </header>

      <Suspense fallback={<UsageLoadingState />}>
        <UsageContent />
      </Suspense>
    </div>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
      <TabsList className="bg-transparent border-b border-border/40 w-full justify-start rounded-none h-auto p-0 gap-6">
        <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold capitalize data-[state=active]:shadow-none -mb-px">
          <LayoutDashboard className="size-3.5 mr-1.5" weight="bold"/>
          Overview
        </TabsTrigger>
        <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold capitalize data-[state=active]:shadow-none -mb-px">
          <Terminal className="size-3.5 mr-1.5" weight="bold"/>
          Traffic Inspector
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 animate-in fade-in duration-500 mt-0">
        <UsageDashboard />
      </TabsContent>

      <TabsContent value="details" className="animate-in fade-in duration-500 mt-0">
        <RequestDetailsTab />
      </TabsContent>
    </Tabs>
  );
}

function PeriodSelector() {
  const [period, setPeriod] = useState("7d");
  return (
    <div className="flex items-center gap-1 bg-muted/30 p-0.5 rounded-none border border-border/40">
      {PERIODS.map(p => (
        <Button
          key={p.value}
          variant={period === p.value ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "h-7 px-2.5 text-[10px] font-bold uppercase transition-all rounded-none", 
            period === p.value ? "bg-background border border-border/40 shadow-none text-foreground" : "text-muted-foreground"
          )}
          onClick={() => {
            setPeriod(p.value);
            window.dispatchEvent(new CustomEvent("usage-period-change", { detail: p.value }));
          }}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

function UsageDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("7d");
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState<"cost" | "tokens">("cost");
  const [providers, setProviders] = useState<any[]>([]);

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "asc";

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const seen = new Set();
        const unique = (d?.connections || []).filter((c: any) => {
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        });
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => (p as any).noAuth && !seen.has((p as any).id))
          .map((p) => ({ provider: (p as any).id, name: (p as any).name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handlePeriodChange = (e: any) => setPeriod(e.detail);
    window.addEventListener("usage-period-change", handlePeriodChange);
    return () => window.removeEventListener("usage-period-change", handlePeriodChange);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setStats((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => ({
          ...(prev || { totalRequests: 0, totalCost: 0, totalPromptTokens: 0, totalCompletionTokens: 0, activeRequests: [], recentRequests: [], errorProvider: "" }),
          activeRequests: data.activeRequests,
          recentRequests: data.recentRequests,
          errorProvider: data.errorProvider,
          pending: data.pending,
        }));
      } catch (err) { console.error(err); }
    };
    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType: string, field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  if (loading && !stats) return <UsageLoadingState />;

  return (
    <div className="space-y-4">
      {/* 1. KPI Pulse Section */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KPIItem label="Requests" value={fmt(stats?.totalRequests ?? 0)} icon={Zap} />
        <KPIItem label="Estimated Cost" value={`$${(stats?.totalCost || 0).toFixed(4)}`} icon={Database} />
        <KPIItem label="Token Volume" value={fmt((stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0))} icon={Pulse} />
        <KPIItem label="Active Streams" value={stats?.activeRequests?.length || 0} icon={Network} />
      </div>

      {/* 2. Live Operations Grid */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Topology Card */}
        <Card className="lg:col-span-8 border-border/40 bg-background/50 shadow-none overflow-hidden flex flex-col h-[420px] rounded-none">
          <CardHeader className="flex flex-row items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/10 shrink-0">
            <div className="flex items-center gap-2">
              <Network className="size-3.5 text-primary" weight="bold"/>
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Infrastructure Flow</CardTitle>
            </div>
            <Badge className="h-4 px-1 bg-primary/10 text-primary border-none text-[10px] font-bold uppercase rounded-none">
              Live
            </Badge>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ProviderTopology
              providers={providers}
              activeRequests={stats?.activeRequests || []}
              lastProvider={stats?.recentRequests?.[0]?.provider || ""}
              errorProvider={stats?.errorProvider || ""}
            />
          </CardContent>
        </Card>

        {/* Live Feed Card */}
        <Card className="lg:col-span-4 border-border/40 bg-background/50 shadow-none overflow-hidden flex flex-col h-[420px] p-0 rounded-none">
          <CardHeader className="flex flex-row items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/10 shrink-0">
            <div className="flex items-center gap-2">
              <History className="size-3.5 text-primary" weight="bold"/>
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Recent Pulse</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0 bg-muted/5">
            <RecentPulseList requests={stats?.recentRequests || []} />
          </CardContent>
          <CardFooter className="p-1 border-t border-border/40 shrink-0 bg-muted/10">
            <Button 
              variant="ghost" 
              size="sm"
              className="w-full h-7 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors group rounded-none"
              onClick={() => router.push("/dashboard/usage?tab=details")}
            >
              Traffic Inspector <ChevronRight className="ml-1 size-2.5 group-hover:translate-x-0.5 transition-transform" weight="bold"/>
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* 3. Deep Analysis Section */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-primary/10 text-primary border border-primary/20">
              <TrendingUp className="size-4" weight="bold"/>
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight">System Performance</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">Historical Metrics</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1 bg-muted/30 p-0.5 border border-border/40">
            <Button 
              variant={viewMode === "cost" ? "secondary" : "ghost"} 
              size="sm"
              className={cn(
                "h-7 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none",
                viewMode === "cost" ? "bg-background border border-border/40 shadow-none text-foreground" : "text-muted-foreground"
              )}
              onClick={() => setViewMode("cost")}
            >
              Costs
            </Button>
            <Button 
              variant={viewMode === "tokens" ? "secondary" : "ghost"} 
              size="sm"
              className={cn(
                "h-7 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none",
                viewMode === "tokens" ? "bg-background border border-border/40 shadow-none text-foreground" : "text-muted-foreground"
              )}
              onClick={() => setViewMode("tokens")}
            >
              Tokens
            </Button>
          </div>
        </div>

        <Card className="border-border/40 bg-background/50 shadow-none overflow-hidden p-0 rounded-none">
          <CardHeader className="flex flex-row items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/10 shrink-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-3.5 text-primary" weight="bold"/>
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Dimensional Analytics</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-6">
            <UsageChart period={period} />
          </CardContent>
        </Card>

        <Tabs value={tableView} onValueChange={setTableView} className="space-y-0">
          <TabsList className="bg-transparent border-b border-border/40 w-full justify-start rounded-none h-auto p-0 gap-6">
            {[
              { value: "model", label: "Model", icon: Cpu },
              { value: "account", label: "Account", icon: ShieldCheck },
              { value: "apiKey", label: "Credential", icon: Key },
              { value: "endpoint", label: "Endpoint", icon: Server },
            ].map(tab => (
              <TabsTrigger 
                key={tab.value}
                value={tab.value} 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold capitalize data-[state=active]:shadow-none -mb-px"
              >
                <tab.icon className="size-3.5 mr-1.5" weight="bold"/>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <Card className="border-border/40 border-t-0 rounded-t-none overflow-hidden p-0 bg-background/50 shadow-none rounded-none">
            <CardContent className="p-0">
              <UsageTableContainer 
                stats={stats} 
                tableView={tableView} 
                sortBy={sortBy} 
                sortOrder={sortOrder} 
                toggleSort={toggleSort}
                viewMode={viewMode}
              />
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </div>
  );
}

function KPIItem({ label, value, icon: Icon }: { label: string, value: string | number, icon: any }) {
  return (
    <Card className="border-border/40 bg-background/50 shadow-none p-0 overflow-hidden hover:bg-muted/5 transition-colors rounded-none">
      <CardHeader className="flex flex-row items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/10 shrink-0">
        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">
          {label}
        </CardTitle>
        <Icon className="size-3.5 text-muted-foreground/60" weight="bold"/>
      </CardHeader>
      <CardContent className="pb-3 pt-3 px-3">
        <div className="text-xl font-bold tracking-tight tabular-nums text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function RecentPulseList({ requests = [] }: { requests: RecentRequest[] }) {
  if (!requests.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center opacity-20">
        <Pulse className="size-8 mb-2" weight="bold" />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Infrastructure Idle</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border/20">
        {requests.map((r, i) => {
          const ok = !r.status || r.status === "ok" || r.status === "success";
          return (
            <div key={i} className="px-3 py-2 hover:bg-muted transition-all flex items-start gap-2.5">
              <div className={cn(
                "size-1 rounded-full mt-1.5 shrink-0", 
                ok ? "bg-primary/60" : "bg-destructive/60"
              )} />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate text-foreground tracking-tight leading-tight">{r.model}</span>
                  <span className="text-[9px] font-bold text-muted-foreground/60 shrink-0 tabular-nums uppercase tracking-tighter">
                    <TimeAgo timestamp={r.timestamp} />
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px] font-bold uppercase border-border/40 bg-muted/40 px-1 h-3.5 rounded-none text-muted-foreground/60 tracking-tighter">
                    {r.provider}
                  </Badge>
                  <div className="flex items-center gap-2 text-[10px] font-bold tabular-nums text-muted-foreground/40">
                    <div className="flex items-center gap-0.5">
                      <ArrowUp className="size-2.5" weight="bold"/>
                      {fmt(r.promptTokens)}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <ArrowDown className="size-2.5" weight="bold"/>
                      {fmt(r.completionTokens)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function UsageTableContainer({ stats, tableView, sortBy, sortOrder, toggleSort, viewMode }: { 
  stats: Stats | null, 
  tableView: string, 
  sortBy: string, 
  sortOrder: "asc" | "desc", 
  toggleSort: (t: string, f: string) => void, 
  viewMode: "cost" | "tokens" 
}) {
  const config = useMemo(() => {
    if (!stats) return null;
    
    const sortData = (dataMap: any, pendingMap: any = {}, sBy: string, sOrder: "asc" | "desc") => {
      return Object.entries(dataMap || {})
        .map(([key, data]: [string, any]) => ({ 
          ...data, 
          key, 
          totalTokens: (data.promptTokens || 0) + (data.completionTokens || 0),
          pending: pendingMap[key] || 0 
        }))
        .sort((a, b) => {
          let valA = a[sBy];
          let valB = b[sBy];
          if (typeof valA === "string") valA = valA.toLowerCase();
          if (typeof valB === "string") valB = valB.toLowerCase();
          return valA < valB ? (sOrder === "asc" ? -1 : 1) : (sOrder === "asc" ? 1 : -1);
        });
    };

    const groupDataByKey = (data: any[], keyField: string) => {
      const groups: Record<string, any> = {};
      data.forEach(item => {
        const gk = item[keyField] || item.rawModel || "Unknown";
        if (!groups[gk]) groups[gk] = { groupKey: gk, summary: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, outputCost: 0, lastUsed: null }, items: [] };
        
        groups[gk].summary.requests += item.requests || 0;
        groups[gk].summary.promptTokens += item.promptTokens || 0;
        groups[gk].summary.completionTokens += item.completionTokens || 0;
        groups[gk].summary.totalTokens += item.totalTokens || ((item.promptTokens || 0) + (item.completionTokens || 0));
        groups[gk].summary.cost += item.cost || item.totalCost || 0;
        groups[gk].summary.inputCost += item.inputCost || 0;
        groups[gk].summary.outputCost += item.outputCost || 0;
        
        if (item.lastUsed && (!groups[gk].summary.lastUsed || new Date(item.lastUsed) > new Date(groups[gk].summary.lastUsed))) {
          groups[gk].summary.lastUsed = item.lastUsed;
        }
        groups[gk].items.push(item);
      });
      return Object.values(groups);
    };

    const COLUMNS: Record<string, any[]> = {
      model: [{ field: "rawModel", label: "Model" }, { field: "provider", label: "Provider" }, { field: "requests", label: "Requests", align: "right" }, { field: "lastUsed", label: "Pulse", align: "right" }],
      account: [{ field: "accountName", label: "Account" }, { field: "rawModel", label: "Last Model" }, { field: "requests", label: "Requests", align: "right" }, { field: "lastUsed", label: "Pulse", align: "right" }],
      apiKey: [{ field: "keyName", label: "Key" }, { field: "rawModel", label: "Last Model" }, { field: "requests", label: "Requests", align: "right" }, { field: "lastUsed", label: "Pulse", align: "right" }],
      endpoint: [{ field: "endpoint", label: "Endpoint" }, { field: "rawModel", label: "Last Model" }, { field: "requests", label: "Requests", align: "right" }, { field: "lastUsed", label: "Pulse", align: "right" }]
    };

    const viewToField: Record<string, string> = { model: "rawModel", account: "accountName", apiKey: "keyName", endpoint: "endpoint" };
    const rawData = stats[tableView === "apiKey" ? "byApiKey" : tableView === "account" ? "byAccount" : tableView === "endpoint" ? "byEndpoint" : "byModel"] || {};
    const pendingMap = stats.pending?.[tableView === "model" ? "byModel" : "byAccount"] || {};

    return {
      columns: COLUMNS[tableView] || COLUMNS.model,
      groupedData: groupDataByKey(sortData(rawData, pendingMap, sortBy, sortOrder), viewToField[tableView] || "rawModel"),
      storageKey: `usage-v2-expanded:${tableView}`
    };
  }, [stats, tableView, sortBy, sortOrder]);

  if (!config) return null;

  return (
    <UsageTable
      columns={config.columns}
      groupedData={config.groupedData}
      tableType={tableView}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onToggleSort={toggleSort}
      viewMode={viewMode === "cost" ? "cost" : "tokens"}
      storageKey={config.storageKey}
      emptyMessage="No data records found for this scope."
      renderSummaryCells={(group) => (
        <>
          <td className="px-3 py-2 text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40">—</td>
          <td className="px-3 py-2 text-right font-bold tabular-nums text-xs">{fmt(group.summary.requests)}</td>
          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums text-[10px] font-bold uppercase tracking-widest opacity-40">
            {group.summary.lastUsed ? timeAgo(group.summary.lastUsed) : "Never"}
          </td>
        </>
      )}
      renderDetailCells={(item) => (
        <>
          <td className="px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-bold tracking-tight">{item[tableView === "apiKey" ? "keyName" : tableView === "account" ? "accountName" : tableView === "endpoint" ? "endpoint" : "rawModel"] || "Unknown"}</span>
              {tableView !== "model" && <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest opacity-60">{item.rawModel}</span>}
            </div>
          </td>
          <td className="px-3 py-2">
            <Badge variant="outline" className="text-[10px] font-bold uppercase border-border/40 bg-muted/40 px-1.5 h-4 rounded-none text-muted-foreground opacity-70">
              {item.provider}
            </Badge>
          </td>
          <td className="px-3 py-2 text-right font-bold tabular-nums text-xs">{fmt(item.requests)}</td>
          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums text-[10px] font-bold uppercase tracking-widest opacity-60">
            {item.lastUsed ? timeAgo(item.lastUsed) : "—"}
          </td>
        </>
      )}
    />
  );
}

function timeAgo(timestamp: string) {
  if (!timestamp) return "Never";
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}S`;
  if (diff < 3600) return `${Math.floor(diff / 60)}M`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}H`;
  return `${Math.floor(diff / 86400)}D`;
}

function TimeAgo({ timestamp }: { timestamp: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  return <span>{timeAgo(timestamp)}</span>;
}

function UsageLoadingState() {
  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-4 p-4 animate-pulse">
      <div className="grid gap-3 md:grid-cols-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 w-full rounded-none border border-border/40"/>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-12 h-[420px]">
        <Skeleton className="lg:col-span-8 rounded-none border border-border/40"/>
        <Skeleton className="lg:col-span-4 rounded-none border border-border/40"/>
      </div>
      <Skeleton className="h-48 w-full rounded-none border border-border/40"/>
    </div>
  );
}

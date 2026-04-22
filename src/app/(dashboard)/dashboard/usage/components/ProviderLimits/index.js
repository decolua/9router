"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, CloudOff, ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowDownAZ, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProviderQuotaCard from "./ProviderQuotaCard";
import QuotaAggregateSummary from "./QuotaAggregateSummary";
import { parseQuotaData, calculatePercentage, getQuotaRemainingPercent } from "./utils";
import { EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const REFRESH_INTERVAL_MS = 60000;

export default function ProviderLimits() {
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [sortBy, setSortBy] = useState("provider");

  const isRefreshingRef = useRef(false);
  const countdownIntervalRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  const fetchConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/client");
      const data = await response.json();
      const list = data.connections || [];
      setConnections(list);
      return list;
    } catch (error) {
      setConnections([]);
      return [];
    }
  }, []);

  const fetchQuota = useCallback(async (connectionId, provider, isSilent = false) => {
    if (!isSilent) setLoading((prev) => ({ ...prev, [connectionId]: true }));
    try {
      const response = await fetch(`/api/usage/${connectionId}`);
      const data = await response.json();
      if (!response.ok) throw new Error("Failed");
      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: {
          quotas: parseQuotaData(provider, data),
          plan: data.plan,
        },
      }));
      setErrors((prev) => ({ ...prev, [connectionId]: null }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, [connectionId]: "Err" }));
    } finally {
      if (!isSilent) setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  const refreshAll = useCallback(async (isSilent = false) => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    if (isSilent) setIsSilentRefreshing(true); else setRefreshingAll(true);
    setCountdown(60);
    try {
      const conns = await fetchConnections();
      const oauthConns = conns.filter(c => USAGE_SUPPORTED_PROVIDERS.includes(c.provider) && c.authType === "oauth");
      await Promise.all(oauthConns.map(c => fetchQuota(c.id, c.provider, isSilent)));
    } finally {
      setRefreshingAll(false);
      setIsSilentRefreshing(false);
      isRefreshingRef.current = false;
    }
  }, [fetchConnections, fetchQuota]);

  useEffect(() => {
    setConnectionsLoading(true);
    refreshAll(false).finally(() => setConnectionsLoading(false));
    refreshIntervalRef.current = setInterval(() => refreshAll(true), REFRESH_INTERVAL_MS);
    countdownIntervalRef.current = setInterval(() => setCountdown(p => (p <= 1 ? 60 : p - 1)), 1000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [refreshAll]);

  const sortedConnections = useMemo(() => {
    const filtered = connections.filter(c => USAGE_SUPPORTED_PROVIDERS.includes(c.provider) && c.authType === "oauth");
    return [...filtered].sort((a, b) => {
      const getVal = (id) => {
        const d = quotaData[id]?.quotas;
        return d?.length ? Math.min(...d.map(getQuotaRemainingPercent)) : (sortBy === "rem_low" ? 101 : -1);
      };
      if (sortBy === "rem_low") return getVal(a.id) - getVal(b.id);
      if (sortBy === "rem_high") return getVal(b.id) - getVal(a.id);
      return a.provider.localeCompare(b.provider);
    });
  }, [connections, quotaData, sortBy]);

  const quotaAggregate = useMemo(() => {
    const session = { sumUsed: 0, sumTotal: 0 };
    const weekly = { sumUsed: 0, sumTotal: 0 };
    connections.forEach(conn => {
      const d = quotaData[conn.id];
      d?.quotas?.forEach(q => {
        if (q.name === "session" && q.total > 0) { session.sumUsed += q.used; session.sumTotal += q.total; }
        else if (q.name === "weekly" && q.total > 0) { weekly.sumUsed += q.used; weekly.sumTotal += q.total; }
      });
    });
    const build = (s) => s.sumTotal > 0 ? { sumUsed: s.sumUsed, sumTotal: s.sumTotal, remainingPct: calculatePercentage(s.sumUsed, s.sumTotal) } : null;
    return { session: build(session), weekly: build(weekly) };
  }, [connections, quotaData]);

  if (connections.length === 0 && !connectionsLoading) return (
    <div className="mx-auto max-w-5xl py-20 text-center text-muted-foreground">
      <CloudOff className="mx-auto mb-4 opacity-10 size-16"/>
      <h3 className="text-lg font-semibold text-foreground">Chưa có kết nối nào</h3>
      <p className="text-sm mt-1 mb-6">Bạn chưa kết nối với nhà cung cấp nào hỗ trợ theo dõi quota.</p>
      <Link href="/dashboard/providers" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
         <Plus className="size-4 mr-2" />
         Quản lý nhà cung cấp
      </Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl flex flex-col gap-6 p-4 lg:p-6">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Hạn mức & Quota</h1>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-500", isSilentRefreshing && "animate-ping")}></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-medium text-muted-foreground uppercase">
              Làm mới sau {countdown}s
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="outline" size="sm" className="h-9 gap-2">
                {sortBy === "provider" ? <ArrowDownAZ className="size-4"/> : sortBy === "rem_low" ? <ArrowDownWideNarrow className="size-4"/> : <ArrowUpNarrowWide className="size-4"/>}
                <span className="hidden sm:inline">Sắp xếp: {sortBy === "provider" ? "Mặc định" : sortBy === "rem_low" ? "Hết Quota" : "Nhiều Quota"}</span>
              </Button>
            } />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("provider")}>Tên A-Z</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("rem_low")}>Quota thấp nhất</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("rem_high")}>Quota cao nhất</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button variant="outline" size="icon" className="size-9" onClick={() => refreshAll(false)} disabled={refreshingAll}>
            {refreshingAll ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}
          </Button>
        </div>
      </header>

      <QuotaAggregateSummary aggregate={quotaAggregate} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {connectionsLoading ? (
           Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)
        ) : sortedConnections.map((conn) => (
          <ProviderQuotaCard
            key={conn.id}
            connection={conn}
            quota={quotaData[conn.id]}
            isLoading={loading[conn.id]}
            isSilentRefreshing={isSilentRefreshing}
            error={errors[conn.id]}
            isInactive={conn.isActive === false}
            onEdit={() => {
              setSelectedConnection(conn);
              setShowEditModal(true);
            }}
          />
        ))}
      </div>

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        onSave={() => {}}
        onClose={() => { setShowEditModal(false); setSelectedConnection(null); }}
      />
    </div>
  );
}

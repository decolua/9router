"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
 CaretRight as ChevronRight, 
 ArrowCounterClockwise as RotateCcw, 
 ArrowSquareOut as ExternalLink, 
 ClockCounterClockwise as History,
 BracketsCurly as FileJson,
 Translate as Languages,
 Code as Code2,
 Terminal,
 Brain as BrainCircuit,
 Funnel as Filter,
 ArrowsClockwise as RefreshCw
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
 Sheet, 
 SheetContent, 
 SheetHeader, 
 SheetTitle, 
 SheetDescription,
} from "@/components/ui/sheet";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";

let providerNameCache: Record<string, any> | null = null;
let providerNodesCache: Record<string, string> | null = null;

async function fetchProviderNames() {
 if (providerNameCache && providerNodesCache) return { providerNameCache, providerNodesCache };
 const nodesRes = await fetch("/api/provider-nodes");
 const nodesData = await nodesRes.json();
 const nodes = nodesData.nodes || [];
 providerNodesCache = {};
 for (const node of nodes) { providerNodesCache[node.id] = node.name; }
 providerNameCache = { ...AI_PROVIDERS, ...providerNodesCache };
 return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId: string, cache: Record<string, any> | null) {
 if (!providerId || !cache) return providerId;
 const cached = cache[providerId];
 if (typeof cached === 'string') return cached;
 if (cached?.name) return cached.name;
 const providerConfig = getProviderByAlias(providerId) || (AI_PROVIDERS as any)[providerId];
 return providerConfig?.name || providerId;
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: any;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon: Icon = null }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/40 rounded-none overflow-hidden bg-muted/5">
      <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/10 transition-colors">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="size-3.5 text-muted-foreground" weight="bold"/>}
          <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground opacity-60">{title}</span>
        </div>
        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform duration-200", isOpen && "rotate-90 text-primary")} weight="bold" />
      </button>
      {isOpen && <div className="p-4 border-t border-border/40 bg-background">{children}</div>}
    </div>
  );
}

function getInputTokens(tokens: any) {
 const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
 const cache = tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
 return prompt < cache ? cache : prompt;
}

interface RequestDetail {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  status: string;
  tokens?: any;
  latency?: {
    ttft: number;
    total: number;
  };
  request?: any;
  providerRequest?: any;
  providerResponse?: any;
  response?: {
    content?: string;
    thinking?: string;
  };
}

interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export default function RequestDetailsTab() {
 const [details, setDetails] = useState<RequestDetail[]>([]);
 const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
 const [loading, setLoading] = useState(false);
 const [selectedDetail, setSelectedDetail] = useState<RequestDetail | null>(null);
 const [isSheetOpen, setIsSheetOpen] = useState(false);
 const [providers, setProviders] = useState<any[]>([]);
 const [providerNameCacheState, setProviderNameCacheState] = useState<Record<string, any> | null>(null);
 const [filters, setFilters] = useState({ provider: "", startDate: "", endDate: "" });

 const fetchProviders = useCallback(async () => {
 try {
 const res = await fetch("/api/usage/providers");
 const data = await res.json();
 setProviders(data.providers || []);
 const cache = await fetchProviderNames();
 setProviderNameCacheState(cache.providerNameCache);
 } catch (error) { console.error(error); }
 }, []);

 const fetchDetails = useCallback(async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams({ page: pagination.page.toString(), pageSize: pagination.pageSize.toString() });
 if (filters.provider) params.append("provider", filters.provider);
 if (filters.startDate) params.append("startDate", filters.startDate);
 if (filters.endDate) params.append("endDate", filters.endDate);
 const res = await fetch(`/api/usage/request-details?${params}`);
 const data = await res.json();
 setDetails(data.details || []);
 setPagination(prev => ({ ...prev, ...data.pagination }));
 } catch (error) { console.error(error); } finally { setLoading(false); }
 }, [pagination.page, pagination.pageSize, filters]);

 useEffect(() => { fetchProviders(); }, [fetchProviders]);
 useEffect(() => { fetchDetails(); }, [fetchDetails]);

 return (
 <div className="flex flex-col gap-6">
 {/* Filters Toolbar */}
 <Card className="border-border/40 bg-background/50 shadow-none rounded-none">
 <CardContent className="p-3 flex flex-wrap items-center gap-3">
 <div className="flex items-center gap-2">
 <Filter className="size-3.5 text-muted-foreground" weight="bold"/>
 <span className="text-[10px] font-bold uppercase tracking-widest text-foreground opacity-60 mr-2">Filter Matrix</span>
 </div>

 <Select value={filters.provider} onValueChange={v => setFilters({ ...filters, provider: v as string })}>
 <SelectTrigger className="h-8 text-xs font-bold uppercase tracking-widest w-[180px] bg-background/50 border-border/40 shadow-none rounded-none"><SelectValue placeholder="All Providers"/></SelectTrigger>
 <SelectContent className="rounded-none border-border/50 shadow-none">
   <SelectItem value="_all_" className="text-xs font-medium">All Providers</SelectItem>
   {providers.map(p => <SelectItem key={p.id} value={p.id} className="text-xs font-medium">{p.name}</SelectItem>)}
 </SelectContent>
 </Select>

 <Input type="datetime-local" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="h-8 text-[10px] w-[180px] bg-background/50 font-mono border-border/40 rounded-none shadow-none"/>
 <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40">To</span>
 <Input type="datetime-local" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="h-8 text-[10px] w-[180px] bg-background/50 font-mono border-border/40 rounded-none shadow-none"/>

 <Button variant="ghost" size="sm" className="h-8 text-[10px] font-bold uppercase tracking-widest ml-auto hover:bg-muted/50" onClick={() => setFilters({ provider: "", startDate: "", endDate: "" })} disabled={!filters.provider && !filters.startDate && !filters.endDate}>
 <RotateCcw className="size-3.5 mr-2" weight="bold"/> Reset
 </Button>
 </CardContent>
 </Card>

      {/* Main Table */}
      <Card className="border-border/40 bg-background/50 shadow-none overflow-hidden p-0 rounded-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/10 border-b border-border/40 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <tr>
            <th className="text-left px-3 py-3">Timestamp</th>
            <th className="text-left px-3 py-3">Model Pipeline</th>
            <th className="text-left px-3 py-3">Provider</th>
            <th className="text-right px-3 py-3">In</th>
            <th className="text-right px-3 py-3">Out</th>
            <th className="text-left px-3 py-3">Latency (TTFT/Total)</th>
            <th className="text-center px-3 py-3">Action</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
            {loading ? (
            <tr><td colSpan={7} className="px-3 py-20 text-center text-muted-foreground animate-pulse"><RefreshCw className="size-6 animate-spin mx-auto mb-2 opacity-20"/><p className="text-[10px] font-bold uppercase tracking-widest">Syncing logs...</p></td></tr>
            ) : details.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-20 text-center opacity-20 text-[10px] font-bold uppercase tracking-widest italic">Awaiting traffic events...</td></tr>
            ) : details.map((d, i) => (

                <tr key={`${d.id}-${i}`} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-3 py-2.5 text-[10px] font-bold tabular-nums text-muted-foreground/60">{new Date(d.timestamp).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</td>
                  <td className="px-3 py-2.5 font-mono font-bold text-xs tracking-tight text-foreground">{d.model}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="h-4 text-[9px] font-bold uppercase border-border/40 bg-muted/40 text-muted-foreground/60 rounded-none tracking-tighter">
                      {getProviderName(d.provider, providerNameCacheState)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold text-primary opacity-60">{getInputTokens(d.tokens).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold text-emerald-500 opacity-60">{(d.tokens?.completion_tokens || 0).toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5 text-[10px] tabular-nums font-bold text-muted-foreground/60 uppercase tracking-tighter">
                      <span>{d.latency?.ttft || 0}ms <span className="opacity-40">TTFT</span></span>
                      <span>{d.latency?.total || 0}ms <span className="opacity-40 font-black">TOTAL</span></span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Button variant="ghost" size="icon" className="size-7 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:text-primary shadow-none" onClick={() => { setSelectedDetail(d); setIsSheetOpen(true); }}>
                      <ExternalLink className="size-3.5" weight="bold" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

 {/* Basic Pagination */}
 {!loading && details.length > 0 && (
 <div className="p-3 border-t border-border/40 bg-muted/5 flex items-center justify-between">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Page {pagination.page} of {pagination.totalPages}</span>
 <div className="flex gap-2">
 <Button variant="outline" size="sm" className="h-7 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background shadow-none" onClick={() => setPagination(p => ({ ...p, page: Math.max(1, p.page - 1) }))} disabled={pagination.page <= 1}>Previous</Button>
 <Button variant="outline" size="sm" className="h-7 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background shadow-none" onClick={() => setPagination(p => ({ ...p, page: Math.min(pagination.totalPages, p.page + 1) }))} disabled={pagination.page >= pagination.totalPages}>Next</Button>
 </div>
 </div>
 )}
 </Card>

 {/* Inspector Sheet */}
 <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
 <SheetContent className="sm:max-w-xl border-l border-border/40 p-0 flex flex-col shadow-2xl rounded-none">
 <SheetHeader className="px-6 py-4 border-b border-border/40 bg-muted/10 shrink-0">
 <div className="flex items-center gap-2 text-primary mb-1">
 <History className="size-4" weight="bold"/>
 <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Transaction Log</span>
 </div>
 <SheetTitle className="text-xl font-bold tracking-tight">Request Forensics</SheetTitle>
 <SheetDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Inspect routing logic and upstream responses.</SheetDescription>
 </SheetHeader>

 <ScrollArea className="flex-1">
 {selectedDetail && (
 <div className="p-6 space-y-8 pb-10">
 {/* Meta Grid */}
 <div className="grid grid-cols-2 gap-y-6 gap-x-4">
 <MetaItem label="Request Identifier" value={selectedDetail.id} mono />
 <MetaItem label="Observation Time" value={new Date(selectedDetail.timestamp).toLocaleString()} />
 <MetaItem label="Infrastructure Model" value={selectedDetail.model} mono />
 <MetaItem label="Service Provider" value={getProviderName(selectedDetail.provider, providerNameCacheState)} />
 <div className="space-y-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Status Descriptor</span>
 <div><Badge className={cn("border-none h-5 text-[10px] font-bold uppercase tracking-widest rounded-none", selectedDetail.status === 'success' ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>{selectedDetail.status === 'success' ? "Success" : "Failed"}</Badge></div>
 </div>
 <div className="space-y-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Execution Latency</span>
 <div className="text-sm font-bold tabular-nums text-foreground">{selectedDetail.latency?.total || 0}ms</div>
 </div>
 </div>

 {/* Data Flow Layers */}
 <div className="space-y-4 pt-4 border-t border-border/40">
 <CollapsibleSection title="Client Egress (Source)" defaultOpen icon={FileJson}>
 <CodeBlock content={selectedDetail.request} />
 </CollapsibleSection>

 {selectedDetail.providerRequest && (
 <CollapsibleSection title="Gateway Routing (Middle)" icon={Languages}>
 <CodeBlock content={selectedDetail.providerRequest} />
 </CollapsibleSection>
 )}

 {selectedDetail.providerResponse && (
 <CollapsibleSection title="Provider Ingress (Upstream)" icon={Code2}>
 <CodeBlock content={selectedDetail.providerResponse} />
 </CollapsibleSection>
 )}

 <CollapsibleSection title="Client Ingress (Result)" defaultOpen icon={Terminal}>
 {selectedDetail.response?.thinking && (
 <div className="mb-4 space-y-2">
 <div className="flex items-center gap-2 text-primary opacity-80">
 <BrainCircuit className="size-4" weight="bold" />
 <span className="text-[10px] font-bold uppercase tracking-widest">Cognitive Chain (Thinking)</span>
 </div>
 <pre className="p-4 rounded-xl bg-muted/30 border border-border/40 text-[11px] leading-relaxed font-mono text-muted-foreground italic whitespace-pre-wrap">{selectedDetail.response.thinking}</pre>
 </div>
 )}
 <CodeBlock content={selectedDetail.response?.content || "[No Content Payload]"} />
 </CollapsibleSection>
 </div>
 </div>
 )}
 </ScrollArea>
 </SheetContent>
 </Sheet>
 </div>
 );
}

function MetaItem({ label, value, mono = false }: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{label}</p>
      <p className={cn("text-xs font-bold truncate text-foreground tracking-tight", mono && "font-mono text-xs text-primary/80")}>{value}</p>
    </div>
  );
}

function CodeBlock({ content }: { content: any }) {
 const text = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
 return (
 <pre className="p-4 rounded-xl bg-muted/40 border border-border/50 font-mono text-[11px] leading-relaxed text-foreground/70 overflow-auto max-h-[400px] no-scrollbar shadow-none">
 {text}
 </pre>
 );
}

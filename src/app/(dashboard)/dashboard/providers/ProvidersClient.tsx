"use client";

import React, { useState, useEffect, useMemo } from "react";
import { 
 Plus, 
 Play, 
 ArrowsClockwise as RefreshCw, 
 PuzzlePiece as Puzzle, 
 CheckCircle, 
 WarningCircle, 
 Key, 
 Cloud, 
 Stack as Layers,
 Sparkle as Sparkles,
 HardDrive as ServerIcon,
 MagnifyingGlass as Search,
 ArrowRight,
 Lightning as Zap
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { 
 TooltipProvider, 
} from "@/components/ui/tooltip";
import { 
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "@/components/ui/empty";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";

interface Connection {
  id: string;
  provider: string;
  authType: string;
  isActive: boolean;
  testStatus: string;
  lastErrorAt?: string;
  lastError?: string;
  lastErrorType?: string;
  errorCode?: string | number;
  name?: string;
  email?: string;
  [key: string]: any;
}

interface ProviderNode {
  id: string;
  type: string;
  name: string;
  prefix: string;
  apiType: string;
  baseUrl: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  category: string;
  authType: string;
  color?: string;
  textIcon?: string;
  apiType?: string;
  isNode?: boolean;
  noAuth?: boolean;
  serviceKinds?: string[];
  deprecated?: boolean;
  deprecationNotice?: string;
  notice?: any;
}

const CATEGORIES = [
 { id: "all", label: "All Providers", icon: Layers },
 { id: "oauth", label: "OAuth / SSO", icon: Cloud },
 { id: "apikey", label: "API Keys", icon: Key },
 { id: "compatible", label: "Endpoints", icon: Puzzle },
 { id: "free", label: "Free / Open", icon: Sparkles },
];

export default function ProvidersPage() {
 const [connections, setConnections] = useState<Connection[]>([]);
 const [providerNodes, setProviderNodes] = useState<ProviderNode[]>([]);
 const [loading, setLoading] = useState(true);
 const [activeCategory, setActiveCategory] = useState("all");
 const [searchQuery, setSearchQuery] = useState("");
 const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
 const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);
 const [testingMode, setTestingMode] = useState<string | null>(null);
 const [testResults, setTestResults] = useState<any>(null);
 const notify = useNotificationStore();

 useEffect(() => {
 const fetchData = async () => {
 try {
 const [connectionsRes, nodesRes] = await Promise.all([
 fetch("/api/providers"),
 fetch("/api/provider-nodes"),
 ]);
 const connectionsData = await connectionsRes.json();
 const nodesData = await nodesRes.json();
 if (connectionsRes.ok) setConnections(connectionsData.connections || []);
 if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
 } catch (error) {
 console.error("Error fetching data:", error);
 } finally {
 setLoading(false);
 }
 };
 fetchData();
 }, []);

 const getProviderStats = (providerId: string, authType: string) => {
 const providerConnections = connections.filter(
 (c) => c.provider === providerId && c.authType === authType,
 );

 const getEffectiveStatus = (conn: Connection) => {
 const isCooldown = Object.entries(conn).some(
 ([k, v]) => k.startsWith("modelLock_") && v && new Date(v as string).getTime() > Date.now(),
 );
 return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
 };

 const connected = providerConnections.filter((c) => {
 const status = getEffectiveStatus(c);
 return status === "active" || status === "success";
 }).length;

 const errorConns = providerConnections.filter((c) => {
 const status = getEffectiveStatus(c);
 return ["error", "expired", "unavailable"].includes(status);
 });

 const error = errorConns.length;
 const total = providerConnections.length;
 const allDisabled = total > 0 && providerConnections.every((c) => c.isActive === false);
 const latestError = errorConns.sort((a, b) => new Date(b.lastErrorAt || 0).getTime() - new Date(a.lastErrorAt || 0).getTime())[0];
 const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
 const errorTime = latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt) : null;

 return { connected, error, total, errorCode, errorTime, allDisabled, latestError };
 };

 const handleToggleProvider = async (providerId: string, authType: string, newActive: boolean) => {
 setConnections((prev) =>
 prev.map((c) => c.provider === providerId && c.authType === authType ? { ...c, isActive: newActive } : c),
 );
 const providerConns = connections.filter((c) => c.provider === providerId && c.authType === authType);
 await Promise.allSettled(
 providerConns.map((c) =>
 fetch(`/api/providers/${c.id}`, {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ isActive: newActive }),
 }),
 ),
 );
 };

 const handleBatchTest = async (mode: string, providerId: string | null = null) => {
 if (testingMode) return;
 setTestingMode(mode === "provider" ? providerId : mode);
 setTestResults(null);
 try {
 const res = await fetch("/api/providers/test-batch", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ mode, providerId }),
 });
 const data = await res.json();
 setTestResults(data);
 if (data.summary) {
 const { passed, failed, total } = data.summary;
 if (failed === 0) notify.success(`All ${total} tests passed`);
 else notify.warning(`${passed}/${total} passed, ${failed} failed`);
 }
 } catch (error) {
 setTestResults({ error: "Test request failed" });
 notify.error("Provider test failed");
 } finally {
 setTestingMode(null);
 }
 };

 const compatibleProviders: ProviderInfo[] = providerNodes
 .filter((node) => node.type === "openai-compatible")
 .map((node) => ({
 id: node.id,
 name: node.name || "OpenAI Compatible",
 color: "#10A37F",
 textIcon: "OC",
 apiType: node.apiType,
 isNode: true,
 category: "compatible",
 authType: "apikey"
 }));

 const anthropicCompatibleProviders: ProviderInfo[] = providerNodes
 .filter((node) => node.type === "anthropic-compatible")
 .map((node) => ({
 id: node.id,
 name: node.name || "Anthropic Compatible",
 color: "#D97757",
 textIcon: "AC",
 isNode: true,
 category: "compatible",
 authType: "apikey"
 }));

 const filteredProviders = useMemo(() => {
 const list: ProviderInfo[] = [];
 
 // OAuth
 if (activeCategory === "all" || activeCategory === "oauth") {
 Object.entries(OAUTH_PROVIDERS).forEach(([id, info]: [string, any]) => {
 list.push({ ...info, id, category: "oauth", authType: "oauth" });
 });
 }

 // API Key
 if (activeCategory === "all" || activeCategory === "apikey") {
 Object.entries(APIKEY_PROVIDERS)
 .filter(([, info]: [string, any]) => (info.serviceKinds ?? ["llm"]).includes("llm"))
 .forEach(([id, info]: [string, any]) => {
 list.push({ ...info, id, category: "apikey", authType: "apikey" });
 });
 }

 // Free
 if (activeCategory === "all" || activeCategory === "free") {
 Object.entries(FREE_PROVIDERS).forEach(([id, info]: [string, any]) => {
 list.push({ ...info, id, category: "free", authType: "oauth" });
 });
 Object.entries(FREE_TIER_PROVIDERS).forEach(([id, info]: [string, any]) => {
 list.push({ ...info, id, category: "free", authType: "apikey" });
 });
 }

 // Compatible
 if (activeCategory === "all" || activeCategory === "compatible") {
 [...compatibleProviders, ...anthropicCompatibleProviders].forEach((info) => {
 list.push({ ...info, category: "compatible", authType: "apikey" });
 });
 }

 return list.filter(p => 
 p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
 p.id.toLowerCase().includes(searchQuery.toLowerCase())
 );
 }, [activeCategory, searchQuery, compatibleProviders, anthropicCompatibleProviders]);

 const globalStats = useMemo(() => {
 const active = connections.filter(c => c.isActive !== false && (c.testStatus === "active" || c.testStatus === "success")).length;
 const errors = connections.filter(c => c.isActive !== false && ["error", "expired", "unavailable"].includes(c.testStatus)).length;
 return { active, errors, total: connections.length };
 }, [connections]);

 if (loading) {
 return <ProvidersLoadingState />;
 }

 return (
 <TooltipProvider>
 <div className="mx-auto flex max-w-6xl flex-col gap-4 py-4 px-4">
 
 {/* Page Header */}
 <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-border/50">
 <div className="space-y-0.5">
 <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-xs uppercase tracking-wider">
 <ServerIcon className="size-3.5" weight="bold"/>
 Dịch vụ chính
 </div>
 <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
 <p className="text-sm text-muted-foreground font-medium">
 {translate("Manage your model providers, API credentials, and connectivity status across the network.")}
 </p>
 </div>

 <div className="flex items-center gap-2">
 <Button
 variant="outline"
 size="sm"
 className="h-8 text-xs font-bold uppercase tracking-wider px-3"
 onClick={() => handleBatchTest("all")}
 disabled={!!testingMode}
 >
 {testingMode ==="all"?(
 <RefreshCw className="size-3.5 mr-1.5 animate-spin" weight="bold"/>
 ):(
 <Play className="size-3.5 mr-1.5" weight="bold"/>
 )}
 Batch Test
 </Button>
 </div>
 </header>

 {/* Filter Bar */}
 <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
 <div className="flex items-center gap-0.5 bg-muted/30 p-0.5 border border-border/50 rounded-lg w-full md:w-auto overflow-x-auto no-scrollbar">
 {CATEGORIES.map((cat) => (
 <button
 key={cat.id}
 onClick={() => setActiveCategory(cat.id)}
 className={cn(
 "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all shrink-0",
 activeCategory === cat.id
 ? "bg-background text-foreground shadow-sm border border-border/50"
 : "text-muted-foreground hover:text-foreground"
 )}
 >
 <cat.icon className="size-3.5" weight={activeCategory === cat.id ?"fill":"bold"}/>
 {cat.label}
 </button>
 ))}
 </div>

 <div className="relative w-full md:w-64 group">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-primary transition-colors" weight="bold"/>
 <Input
 placeholder="Search providers..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="pl-9 h-8 text-sm bg-muted/10 border-border/40 focus:bg-background transition-all"
 />
 </div>
 </div>

 {/* Stats Overview */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 <StatCard label="Active" value={globalStats.active} icon={CheckCircle} color="text-primary"/>
 <StatCard label="Issues" value={globalStats.errors} icon={WarningCircle} color="text-destructive"/>
 <StatCard label="Total" value={globalStats.total} icon={ServerIcon} color="text-foreground/70"/>
 </div>

 {/* Dynamic Grid */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
 {filteredProviders.length > 0 ? (
 filteredProviders.map(provider => (
 <NewProviderCard 
 key={provider.id}
 provider={provider}
 stats={getProviderStats(provider.id, provider.authType)}
 testingMode={testingMode}
 onToggle={(v) => handleToggleProvider(provider.id, provider.authType, v)}
 onTest={() => handleBatchTest("provider", provider.id)}
 />
 ))
 ) : (
 <div className="col-span-full py-16">
 <Empty>
 <EmptyHeader>
 <EmptyMedia variant="icon">
 <Search />
 </EmptyMedia>
 </EmptyHeader>
 <EmptyContent>
 <EmptyTitle>No providers found</EmptyTitle>
 <EmptyDescription>Try adjusting your search or filters to find what you're looking for.</EmptyDescription>
 </EmptyContent>
 <Button variant="outline" size="sm" onClick={() => { setActiveCategory("all"); setSearchQuery(""); }}>
 Clear all filters
 </Button>
 </Empty>
 </div>
 )}

 {/* Add Compatible Slot */}
 {(activeCategory === "all" || activeCategory === "compatible") && (
 <button 
 className="group relative transition-all duration-200 border border-dashed border-border/60 bg-muted/5 hover:bg-muted/10 hover:border-primary/30 rounded-lg overflow-hidden h-fit text-left cursor-pointer"
 onClick={() => setShowAddCompatibleModal(true)}
 >
 <div className="p-3 flex flex-col gap-2">
 <div className="flex items-center gap-2.5 w-full">
 <div className="size-8 rounded border border-dashed border-border/60 bg-muted/10 flex items-center justify-center p-1.5 shrink-0 group-hover:bg-primary/10 group-hover:border-primary/30 transition-colors">
 <Plus className="size-4 text-muted-foreground group-hover:text-primary" weight="bold" />
 </div>
 <h3 className="text-sm font-medium tracking-tight text-muted-foreground group-hover:text-primary transition-colors">
 {translate("Add Endpoint")}
 </h3>
 </div>
 <div className="flex items-center justify-between pl-10.5 mt-0.5">
 <div className="text-[10px] text-muted-foreground/40 font-semibold uppercase tracking-wider">
 {translate("OpenAI Compatible")}
 </div>
 </div>
 </div>
 </button>
 )}
 </div>

 {/* Modals & Views */}
 <AddOpenAICompatibleModal
 isOpen={showAddCompatibleModal}
 onClose={() => setShowAddCompatibleModal(false)}
 onCreated={(node) => {
 setProviderNodes((prev) => [...prev, node]);
 setShowAddCompatibleModal(false);
 }}
 />
 <AddAnthropicCompatibleModal
 isOpen={showAddAnthropicCompatibleModal}
 onClose={() => setShowAddAnthropicCompatibleModal(false)}
 onCreated={(node) => {
 setProviderNodes((prev) => [...prev, node]);
 setShowAddAnthropicCompatibleModal(false);
 }}
 />

 <Dialog open={!!testResults} onOpenChange={(open) => !open && setTestResults(null)}>
 <DialogContent className="max-w-2xl border-border/50 overflow-hidden p-0 shadow-none">
 <div className="bg-muted/10 p-6 border-b border-border/50">
 <DialogHeader>
 <DialogTitle className="text-xl font-medium flex items-center gap-3">
 <Zap className="size-5 text-primary" weight="fill" />
 Integration Diagnostics
 </DialogTitle>
 <DialogDescription className="text-xs">
 Validation results for your active provider connections.
 </DialogDescription>
 </DialogHeader>
 </div>
 <div className="p-6 max-h-[60vh] overflow-y-auto bg-transparent">
 {testResults && <ProviderTestResultsView results={testResults} />}
 </div>
 <DialogFooter className="p-4 bg-muted/5 border-t border-border/50">
 <Button onClick={() => setTestResults(null)} className="w-full font-medium" size="sm">Close Report</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 </TooltipProvider>
 );
}

/** 
 * Clean Provider Card:
 * - Minimalist, white-space heavy
 * - Avatar for icons
 * - Subtle badges and indicators
 */
function NewProviderCard({ provider, stats, testingMode, onToggle, onTest }: { 
  provider: ProviderInfo, 
  stats: any, 
  testingMode: string | null, 
  onToggle: (v: boolean) => void, 
  onTest: () => void 
}) {
 const { connected, error, errorCode, allDisabled, total } = stats;
 const isTesting = testingMode === provider.id;
 const isNoAuth = !!provider.noAuth;

 const getIconPath = () => {
 if (provider.isNode) {
 if (provider.id.startsWith(OPENAI_COMPATIBLE_PREFIX)) {
 return provider.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
 }
 return "/providers/anthropic-m.png";
 }
 return `/providers/${provider.id}.png`;
 };

 return (
 <Card className={cn(
 "group relative transition-all duration-200 border-border/50 bg-transparent hover:bg-muted/10 shadow-none rounded-lg overflow-hidden h-fit p-0",
 allDisabled && "opacity-50 grayscale"
 )}>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2 border-b border-border/50">
 <div className="flex items-center gap-2.5 min-w-0">
 <div className="size-8 rounded border border-border/40 bg-background flex items-center justify-center p-1.5 shrink-0 group-hover:border-primary/30 transition-colors">
 <img 
 src={getIconPath()} 
 alt={provider.name} 
 className={cn(
 "size-full object-contain",
 (provider.id === "codex" || provider.id === "openai" || provider.id === "github") && "dark:invert"
 )}
 onError={(e: any) => {
 e.target.style.display = 'none';
 e.target.nextSibling.style.display = 'flex';
 }}
 />
 <div className="hidden size-full items-center justify-center text-[10px] font-bold uppercase tracking-tight" style={{ color: provider.color }}>
 {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
 </div>
 </div>
 <div className="min-w-0 flex flex-col">
 <CardTitle className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
 {provider.name}
 </CardTitle>
 <CardDescription className="text-[10px] text-muted-foreground/60 font-medium tracking-wide uppercase">
 {provider.authType}
 </CardDescription>
 </div>
 </div>

 {total > 0 && (
 <Switch 
 checked={!allDisabled} 
 onCheckedChange={onToggle} 
 className="scale-[0.6] data-[state=checked]:bg-primary transition-all shrink-0 -mr-2"
 />
 )}
 </CardHeader>

 <CardContent className="px-3 py-2 flex flex-col gap-2">
 {/* Info & Actions Row */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 font-medium tracking-wide">
 {connected > 0 && !allDisabled && (
 <span className="text-primary/90 font-semibold tabular-nums">{connected} {translate("nodes")}</span>
 )}
 {!allDisabled && isNoAuth && (
 <span className="text-primary font-semibold">{translate("Ready")}</span>
 )}
 {!allDisabled && total === 0 && (
 <span>{translate("no connections")}</span>
 )}
 </div>

 <div className="flex items-center gap-1.5">
 {!allDisabled && total > 0 && (
 <Button
 variant="ghost"
 size="icon"
 className="size-6 rounded-full hover:bg-primary/10 hover:text-primary transition-all text-muted-foreground/50"
 onClick={(e) => { e.preventDefault(); onTest(); }}
 disabled={isTesting}
 >
 {isTesting ? <RefreshCw className="size-3 animate-spin"/> : <Play className="size-3" weight="fill" />}
 </Button>
 )}
 <Link 
 href={`/dashboard/providers/${provider.id}`} 
 className="text-[10px] font-semibold text-muted-foreground/40 hover:text-primary transition-colors tracking-wider px-1.5 py-0.5 inline-flex items-center gap-0.5"
 >
 {translate("Setup")}
 <ArrowRight className="size-2.5" weight="bold" />
 </Link>
 </div>
 </div>

 {/* Error Row (if any) */}
 {!allDisabled && error > 0 && (
 <div className="flex items-center gap-1.5 pt-0.5">
 <div className="size-1.5 rounded-full bg-destructive animate-pulse"/>
 <span className="text-[10px] font-semibold text-destructive tracking-wider truncate">{errorCode || error} error</span>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function StatCard({ label, value, icon: Icon, color }: { label: string, value: number, icon: any, color: string }) {
 return (
 <Card className="flex items-center gap-3 px-3 py-2 min-w-[100px] border-border/40 shadow-none rounded-lg bg-muted/5">
 <div className={cn("p-2 rounded-md bg-muted/20", color.replace('text-', 'bg-').replace('destructive', 'destructive/10').replace('primary', 'primary/10'))}>
 <Icon className={cn("size-4", color)} weight="bold" />
 </div>
 <div className="flex flex-col">
 <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase leading-none mb-1">{translate(label)}</span>
 <span className="text-base font-semibold tabular-nums leading-none tracking-tight">{value}</span>
 </div>
 </Card>
 );
}


function ProvidersLoadingState() {
 return (
 <div className="mx-auto flex max-w-7xl flex-col gap-8 pb-10 px-4">
 <div className="space-y-3 py-8">
 <Skeleton className="h-8 w-48 rounded-lg"/>
 <Skeleton className="h-4 w-full max-w-md rounded-md"/>
 </div>
 <div className="flex gap-2 p-1 border border-border/40 rounded-xl bg-muted/10">
 {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-24 rounded-lg"/>)}
 </div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
 {Array.from({ length: 8 }).map((_, i) => (
 <Skeleton key={i} className="h-32 w-full rounded-xl"/>
 ))}
 </div>
 </div>
 );
}

/** Logic helper functions */
function getConnectionErrorTag(connection: Connection): string {
 if (!connection) return "ERR";
 const explicitType = connection.lastErrorType;
 if (explicitType === "runtime_error") return "RUNTIME";
 if (["upstream_auth_error", "auth_missing", "token_refresh_failed", "token_expired"].includes(explicitType || "")) return "AUTH";
 if (explicitType === "upstream_rate_limited") return "429";
 if (explicitType === "upstream_unavailable") return "5XX";
 if (explicitType === "network_error") return "NET";

 const numericCode = Number(connection.errorCode);
 if (Number.isFinite(numericCode) && numericCode >= 400) return String(numericCode);

 const fromMessage = getErrorCode(connection.lastError || "");
 if (fromMessage === "401" || fromMessage === "403") return "AUTH";
 if (fromMessage && fromMessage !== "ERR") return fromMessage;

 const msg = (connection.lastError || "").toLowerCase();
 if (msg.includes("runtime") || msg.includes("not runnable") || msg.includes("not installed")) return "RUNTIME";
 if (msg.includes("invalid api key") || msg.includes("token invalid") || msg.includes("revoked") || msg.includes("unauthorized")) return "AUTH";

 return "ERR";
}

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }: { isOpen: boolean, onClose: () => void, onCreated: (node: ProviderNode) => void }) {
 const [formData, setFormData] = useState({ name: "", prefix: "", apiType: "chat", baseUrl: "https://api.openai.com/v1" });
 const [submitting, setSubmitting] = useState(false);
 const [checkKey, setCheckKey] = useState("");
 const [checkModelId, setCheckModelId] = useState("");
 const [validating, setValidating] = useState(false);
 const [validationResult, setValidationResult] = useState<any>(null);

 const handleSubmit = async () => {
 if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
 setSubmitting(true);
 try {
 const res = await fetch("/api/provider-nodes", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ...formData, type: "openai-compatible" }),
 });
 const data = await res.json();
 if (res.ok) {
 onCreated(data.node);
 setFormData({ name: "", prefix: "", apiType: "chat", baseUrl: "https://api.openai.com/v1" });
 }
 } catch (e) { console.error(e); } finally { setSubmitting(false); }
 };

 const handleValidate = async () => {
 setValidating(true);
 try {
 const res = await fetch("/api/provider-nodes/validate", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: "openai-compatible", modelId: checkModelId.trim() || undefined }),
 });
 setValidationResult(await res.json());
 } catch { setValidationResult({ valid: false, error: "Network error" }); } finally { setValidating(false); }
 };

 return (
 <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
 <DialogContent className="max-w-md border-border/50 shadow-none">
 <DialogHeader><DialogTitle className="text-lg font-medium tracking-tight">Add OpenAI Compatible</DialogTitle></DialogHeader>
 <div className="space-y-4 pt-4">
 <div className="grid gap-2">
 <Label htmlFor="oai-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</Label>
 <Input id="oai-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label htmlFor="oai-prefix" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prefix</Label>
 <Input id="oai-prefix" value={formData.prefix} onChange={(e) => setFormData({ ...formData, prefix: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Type</Label>
 <Select value={formData.apiType} onValueChange={(v) => setFormData({ ...formData, apiType: v as string })}>
 <SelectTrigger className="h-9 bg-muted/10 border-border/40"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="chat">Chat Completions</SelectItem>
 <SelectItem value="responses">Responses API</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="grid gap-2">
 <Label htmlFor="oai-base" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</Label>
 <Input id="oai-base" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label htmlFor="oai-key" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key (Test)</Label>
 <Input id="oai-key" type="password" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="flex items-center gap-3">
 <Button size="sm" variant="secondary" onClick={handleValidate} disabled={!checkKey || validating} className="h-8">{validating ? "Checking..." : "Check"}</Button>
 {validationResult && (
 <Badge variant={validationResult.valid ? "secondary" : "destructive"} className="h-5 px-1.5 border-none">
 {validationResult.valid ? "Valid" : "Invalid"}
 </Badge>
 )}
 </div>
 <div className="flex gap-2 pt-4">
 <Button className="flex-1" onClick={handleSubmit} disabled={submitting} size="sm">Create</Button>
 <Button variant="outline" className="flex-1" onClick={onClose} size="sm">Cancel</Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}

function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }: { isOpen: boolean, onClose: () => void, onCreated: (node: ProviderNode) => void }) {
 const [formData, setFormData] = useState({ name: "", prefix: "", baseUrl: "https://api.anthropic.com/v1" });
 const [submitting, setSubmitting] = useState(false);
 const [checkKey, setCheckKey] = useState("");
 const [validating, setValidating] = useState(false);
 const [validationResult, setValidationResult] = useState<any>(null);

 const handleSubmit = async () => {
 if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
 setSubmitting(true);
 try {
 const res = await fetch("/api/provider-nodes", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ...formData, type: "anthropic-compatible" }),
 });
 const data = await res.json();
 if (res.ok) { onCreated(data.node); setFormData({ name: "", prefix: "", baseUrl: "https://api.anthropic.com/v1" }); }
 } catch (e) { console.error(e); } finally { setSubmitting(false); }
 };

 const handleValidate = async () => {
 setValidating(true);
 try {
 const res = await fetch("/api/provider-nodes/validate", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: "anthropic-compatible" }),
 });
 setValidationResult(await res.json());
 } catch { setValidationResult({ valid: false, error: "Network error" }); } finally { setValidating(false); }
 };

 return (
 <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
 <DialogContent className="max-w-md border-border/50 shadow-none">
 <DialogHeader><DialogTitle className="text-lg font-medium tracking-tight">Add Anthropic Compatible</DialogTitle></DialogHeader>
 <div className="space-y-4 pt-4">
 <div className="grid gap-2">
 <Label htmlFor="anth-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</Label>
 <Input id="anth-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label htmlFor="anth-prefix" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prefix</Label>
 <Input id="anth-prefix" value={formData.prefix} onChange={(e) => setFormData({ ...formData, prefix: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label htmlFor="anth-base" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</Label>
 <Input id="anth-base" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label htmlFor="anth-key" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key (Test)</Label>
 <Input id="anth-key" type="password" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} className="h-9 bg-muted/10 border-border/40" />
 </div>
 <div className="flex items-center gap-3">
 <Button size="sm" variant="secondary" onClick={handleValidate} disabled={!checkKey || validating} className="h-8">{validating ? "Checking..." : "Check"}</Button>
 {validationResult && (
 <Badge variant={validationResult.valid ? "secondary" : "destructive"} className="h-5 px-1.5 border-none">
 {validationResult.valid ? "Valid" : "Invalid"}
 </Badge>
 )}
 </div>
 <div className="flex gap-2 pt-4">
 <Button className="flex-1" onClick={handleSubmit} disabled={submitting} size="sm">Create</Button>
 <Button variant="outline" className="flex-1" onClick={onClose} size="sm">Cancel</Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}

function ProviderTestResultsView({ results }: { results: any }) {
 if (results.error && !results.results) {
 return <div className="py-6 text-center text-sm text-destructive">{results.error}</div>;
 }
 return (
 <div className="space-y-1.5 pt-2">
 {results.results?.map((r: any, i: number) => (
 <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-muted/5 text-xs">
 <div className="flex flex-col gap-0.5">
 <span className="font-medium text-foreground">{r.connectionName}</span>
 <span className="text-muted-foreground/60 uppercase text-xs tracking-wider">{r.provider}</span>
 </div>
 <Badge variant={r.valid ? "secondary" : "destructive"} className="text-xs h-5 px-1.5 border-none bg-primary/10 text-primary dark:text-primary font-bold">
 {r.valid ? "SUCCESS" : "FAILED"}
 </Badge>
 </div>
 ))}
 </div>
 );
}

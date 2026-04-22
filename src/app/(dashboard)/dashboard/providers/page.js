"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { 
  Plus, 
  Play, 
  RefreshCw, 
  Puzzle, 
  PauseCircle, 
  Search, 
  Filter, 
  LayoutGrid, 
  List, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ShieldCheck, 
  Key, 
  Cloud, 
  Zap, 
  Globe, 
  Activity, 
  SearchCode,
  ArrowRight,
  MoreVertical,
  Layers,
  Sparkles,
  Command,
  Settings,
  HelpCircle,
  AlertTriangle,
  Server
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter 
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
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";

const CATEGORIES = [
  { id: "all", label: "All Providers", icon: Layers },
  { id: "oauth", label: "OAuth / SSO", icon: Cloud },
  { id: "apikey", label: "API Keys", icon: Key },
  { id: "compatible", label: "Endpoints", icon: Puzzle },
  { id: "free", label: "Free / Open", icon: Sparkles },
];

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
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

  const getProviderStats = (providerId, authType) => {
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && c.authType === authType,
    );

    const getEffectiveStatus = (conn) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
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
    const latestError = errorConns.sort((a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0))[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt) : null;

    return { connected, error, total, errorCode, errorTime, allDisabled, latestError };
  };

  const handleToggleProvider = async (providerId, authType, newActive) => {
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

  const handleBatchTest = async (mode, providerId = null) => {
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

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
      isNode: true
    }));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
      isNode: true
    }));

  const filteredProviders = useMemo(() => {
    const list = [];
    
    // OAuth
    if (activeCategory === "all" || activeCategory === "oauth") {
      Object.entries(OAUTH_PROVIDERS).forEach(([id, info]) => {
        list.push({ ...info, id, category: "oauth", authType: "oauth" });
      });
    }

    // API Key
    if (activeCategory === "all" || activeCategory === "apikey") {
      Object.entries(APIKEY_PROVIDERS)
        .filter(([, info]) => (info.serviceKinds ?? ["llm"]).includes("llm"))
        .forEach(([id, info]) => {
          list.push({ ...info, id, category: "apikey", authType: "apikey" });
        });
    }

    // Free
    if (activeCategory === "all" || activeCategory === "free") {
      Object.entries(FREE_PROVIDERS).forEach(([id, info]) => {
        list.push({ ...info, id, category: "free", authType: "oauth" });
      });
      Object.entries(FREE_TIER_PROVIDERS).forEach(([id, info]) => {
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
  }, [activeCategory, searchQuery, providerNodes]);

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
      <div className="mx-auto flex max-w-7xl flex-col gap-8 pb-10 px-4">
        
        {/* Minimalist Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 py-8">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-medium text-[10px] uppercase tracking-wider px-2 py-0 h-5">
                Infrastructure
              </Badge>
              <Separator orientation="vertical" className="h-3" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Service Mesh</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">AI Providers</h1>
            <p className="text-sm text-muted-foreground max-w-lg">
              Manage your model providers, API credentials, and connectivity status across the network.
            </p>
          </div>

          <div className="flex items-center gap-3">
             <StatCard label="Active" value={globalStats.active} icon={CheckCircle2} color="text-emerald-500" />
             <StatCard label="Issues" value={globalStats.errors} icon={AlertCircle} color="text-red-500" />
             <StatCard label="Total" value={globalStats.total} icon={Server} color="text-blue-500" />
          </div>
        </header>

        {/* Toolbar: Category + Search */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between py-1 px-1 rounded-xl border bg-card/50 shadow-sm sticky top-4 z-10 backdrop-blur-xl">
           <div className="w-full md:w-auto overflow-x-auto no-scrollbar px-1 py-1">
              <ToggleGroup 
                type="single" 
                value={activeCategory} 
                onValueChange={(v) => v && setActiveCategory(v)}
                className="justify-start gap-1"
              >
                {CATEGORIES.map(cat => (
                  <ToggleGroupItem
                    key={cat.id}
                    value={cat.id}
                    className="h-8 px-3 text-xs font-medium gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-all"
                  >
                    <cat.icon className="size-3.5" />
                    {cat.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
           </div>
           
           <div className="flex items-center gap-2 w-full md:w-80 px-1 py-1">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input 
                  placeholder="Search providers..." 
                  className="pl-9 h-8 border-none bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary/20 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hover:bg-muted">
                <Filter className="size-3.5 text-muted-foreground" />
              </Button>
           </div>
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
                  <EmptyMedia variant="icon">
                    <SearchCode />
                  </EmptyMedia>
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
                className="group relative transition-all duration-200 border border-dashed border-muted/60 bg-muted/5 hover:bg-muted/10 hover:border-primary/30 rounded-lg overflow-hidden h-fit text-left" 
                onClick={() => setShowAddCompatibleModal(true)}
              >
                <div className="p-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 w-full">
                    <div className="size-7 rounded border border-dashed border-muted-foreground/30 bg-muted/10 flex items-center justify-center p-1.5 shrink-0 group-hover:bg-primary/10 group-hover:border-primary/30 transition-colors">
                      <Plus className="size-3.5 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <h3 className="text-[13px] font-bold tracking-tight text-muted-foreground group-hover:text-primary transition-colors">
                      {translate("Add Endpoint")}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between pl-9 mt-0.5">
                    <div className="text-[9px] text-muted-foreground/40 font-semibold uppercase tracking-wider">
                       {translate("OpenAI Compatible")}
                    </div>
                    <span className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-widest">{translate("Infrastructure")}</span>
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
          <DialogContent className="max-w-2xl border-primary/20 shadow-2xl overflow-hidden p-0">
            <div className="bg-muted/30 p-6 border-b">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black flex items-center gap-3">
                  <Zap className="size-6 text-primary" />
                  Integration Diagnostics
                </DialogTitle>
                <DialogDescription>
                  Validation results for your active provider connections.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {testResults && <ProviderTestResultsView results={testResults} />}
            </div>
            <DialogFooter className="p-4 bg-muted/10 border-t">
              <Button onClick={() => setTestResults(null)} className="w-full font-bold">Close Report</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/** 
 * Tinh chỉnh Card nhà cung cấp:
 * - Layout gọn gàng, tech-focused
 * - Trạng thái trực quan
 * - Tương tác nhanh (Test, Toggle)
 */
/** 
 * Clean Provider Card:
 * - Minimalist, white-space heavy
 * - Avatar for icons
 * - Subtle badges and indicators
 */
function NewProviderCard({ provider, stats, testingMode, onToggle, onTest }) {
  const { connected, error, errorCode, errorTime, allDisabled, total } = stats;
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
      "group relative transition-all duration-200 border-muted/50 shadow-none bg-card hover:border-primary/30 rounded-lg overflow-hidden h-fit",
      allDisabled && "opacity-50 grayscale"
    )}>
      <div className="p-2.5 flex flex-col gap-2">
        {/* Main Row: Icon + Name + Switch */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-7 rounded border border-muted/40 bg-muted/5 flex items-center justify-center p-1 shrink-0 group-hover:bg-background transition-colors">
               <img 
                 src={getIconPath()} 
                 alt={provider.name} 
                 className="size-full object-contain" 
                 onError={(e) => {
                   e.target.style.display = 'none';
                   e.target.nextSibling.style.display = 'flex';
                 }}
               />
               <div className="hidden size-full items-center justify-center text-[7px] font-bold uppercase tracking-tight" style={{ color: provider.color }}>
                 {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
               </div>
            </div>
            <h3 className="text-[13px] font-bold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
              {provider.name}
            </h3>
          </div>

          {total > 0 && (
            <Switch 
              checked={!allDisabled} 
              onCheckedChange={onToggle} 
              className="scale-[0.55] data-[state=checked]:bg-primary transition-all shrink-0 -mr-2"
            />
          )}
        </div>

        {/* Info & Actions Row */}
        <div className="flex items-center justify-between pl-9 mt-0.5">
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
            <span>{provider.authType}</span>
            {connected > 0 && !allDisabled && (
              <>
                <span className="opacity-30">·</span>
                <span className="text-primary/80 font-bold">{connected} {translate("Nodes")}</span>
              </>
            )}
            {!allDisabled && isNoAuth && (
              <>
                <span className="opacity-30">·</span>
                <span className="text-emerald-600 font-bold">{translate("Ready")}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
            {!allDisabled && total > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-5 rounded-full hover:bg-primary/10 hover:text-primary transition-all"
                onClick={(e) => { e.preventDefault(); onTest(); }}
                disabled={isTesting}
              >
                {isTesting ? <RefreshCw className="size-2 animate-spin" /> : <Play className="size-2" />}
              </Button>
            )}
            <Link 
              href={`/dashboard/providers/${provider.id}`} 
              className="text-[9px] font-bold text-muted-foreground/40 hover:text-primary transition-colors uppercase tracking-widest px-1"
            >
              {translate("Configure")}
            </Link>
          </div>
        </div>

        {/* Error Row (if any) */}
        {!allDisabled && error > 0 && (
          <div className="pl-9 flex items-center gap-1.5">
            <div className="size-1 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[8px] font-bold text-red-500 uppercase tracking-tighter">{errorCode || error} ERR</span>
          </div>
        )}
      </div>
    </Card>
  );
}function StatCard({ label, value, icon: Icon, color }) {
  return (
    <Card className="flex items-center gap-4 px-4 py-3 min-w-[120px] shadow-none border-muted/60 rounded-xl bg-card/50">
      <div className={cn("p-2 rounded-lg bg-muted/50", color.replace('text-', 'bg-').replace('500', '500/10'))}>
        <Icon className={cn("size-4", color)} />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-lg font-bold tabular-nums leading-none tracking-tight">{value}</span>
      </div>
    </Card>
  );
}

function ProvidersLoadingState() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 pb-10 px-4">
      <div className="space-y-3 py-8">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-4 w-full max-w-md rounded-md" />
      </div>
      <div className="flex gap-2 p-1 border rounded-xl bg-muted/10">
         {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-24 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[180px] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
/** Logic helper functions */
function getConnectionErrorTag(connection) {
  if (!connection) return null;
  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (["upstream_auth_error", "auth_missing", "token_refresh_failed", "token_expired"].includes(explicitType)) return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400) return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (msg.includes("runtime") || msg.includes("not runnable") || msg.includes("not installed")) return "RUNTIME";
  if (msg.includes("invalid api key") || msg.includes("token invalid") || msg.includes("revoked") || msg.includes("unauthorized")) return "AUTH";

  return "ERR";
}

ProvidersPage.propTypes = {
  // machineId: PropTypes.string.isRequired, // Not used in this version but kept for consistency
};

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({ name: "", prefix: "", apiType: "chat", baseUrl: "https://api.openai.com/v1" });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

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
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add OpenAI Compatible</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="oai-name">Name</Label>
            <Input id="oai-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="oai-prefix">Prefix</Label>
            <Input id="oai-prefix" value={formData.prefix} onChange={(e) => setFormData({ ...formData, prefix: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>API Type</Label>
            <Select value={formData.apiType} onValueChange={(v) => setFormData({ ...formData, apiType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">Chat Completions</SelectItem>
                <SelectItem value="responses">Responses API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="oai-base">Base URL</Label>
            <Input id="oai-base" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="oai-key">API Key (Test)</Label>
            <Input id="oai-key" type="password" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={handleValidate} disabled={!checkKey || validating}>{validating ? "Checking..." : "Check"}</Button>
            {validationResult && (
              <Badge variant={validationResult.valid ? "secondary" : "destructive"}>
                {validationResult.valid ? "Valid" : "Invalid"}
              </Badge>
            )}
          </div>
          <div className="flex gap-2 pt-4">
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>Create</Button>
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({ name: "", prefix: "", baseUrl: "https://api.anthropic.com/v1" });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

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
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Anthropic Compatible</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="anth-name">Name</Label>
            <Input id="anth-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="anth-prefix">Prefix</Label>
            <Input id="anth-prefix" value={formData.prefix} onChange={(e) => setFormData({ ...formData, prefix: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="anth-base">Base URL</Label>
            <Input id="anth-base" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="anth-key">API Key (Test)</Label>
            <Input id="anth-key" type="password" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={handleValidate} disabled={!checkKey || validating}>{validating ? "Checking..." : "Check"}</Button>
            {validationResult && (
              <Badge variant={validationResult.valid ? "secondary" : "destructive"}>
                {validationResult.valid ? "Valid" : "Invalid"}
              </Badge>
            )}
          </div>
          <div className="flex gap-2 pt-4">
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>Create</Button>
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return <div className="py-6 text-center text-sm text-destructive">{results.error}</div>;
  }
  return (
    <div className="space-y-2 pt-4">
      {results.results?.map((r, i) => (
        <div key={i} className="flex items-center justify-between p-2 rounded border bg-muted/30 text-xs">
          <div className="flex flex-col">
            <span className="font-semibold">{r.connectionName}</span>
            <span className="text-muted-foreground">{r.provider}</span>
          </div>
          <Badge variant={r.valid ? "secondary" : "destructive"} className="text-[10px] h-5 px-1.5 border-none bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            {r.valid ? "OK" : "ERR"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Cookie,
  PencilSimple as Pencil,
  Plus,
  Trash,
  ArrowLeft,
  Warning,
  Info,
  Lock,
  LockOpen,
  Key,
  ShieldCheck,
  CircleNotch,
  CheckCircle,
  WarningCircle as AlertCircle
} from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { translate } from "@/i18n/runtime";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardFooter 
} from "@/components/ui/card";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogFooter,
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
 OAuthModal,
 KiroOAuthWrapper,
 CursorAuthModal,
 IFlowCookieModal,
 GitLabAuthModal,
 EditConnectionModal,
} from "@/shared/components";
import { 
  OAUTH_PROVIDERS, 
  APIKEY_PROVIDERS, 
  FREE_PROVIDERS, 
  FREE_TIER_PROVIDERS, 
  getProviderAlias, 
  isOpenAICompatibleProvider, 
  isAnthropicCompatibleProvider, 
  AI_PROVIDERS, 
  THINKING_CONFIG 
} from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import ModelRow from "./ModelRow";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import AddApiKeyModal from "./AddApiKeyModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import AddCustomModelModal from "./AddCustomModelModal";

interface Connection {
  id: string;
  provider: string;
  authType: string;
  isActive: boolean;
  testStatus: string;
  priority: number;
  lastErrorAt?: string;
  lastError?: string;
  lastErrorType?: string;
  errorCode?: string | number;
  name?: string;
  email?: string;
  providerSpecificData?: {
    proxyPoolId?: string | null;
    [key: string]: any;
  };
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

interface ProxyPool {
  id: string;
  name: string;
}

interface Model {
  id: string;
  name?: string;
  isFree?: boolean;
  type?: string;
  [key: string]: any;
}

export default function ProviderDetailPage() {
 const params = useParams();
 const router = useRouter();
 const providerId = params.id as string;
 const [connections, setConnections] = useState<Connection[]>([]);
 const [loading, setLoading] = useState(true);
 const [providerNode, setProviderNode] = useState<ProviderNode | null>(null);
 const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
 const [showOAuthModal, setShowOAuthModal] = useState(false);
 const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
 const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
 const [showEditModal, setShowEditModal] = useState(false);
 const [showEditNodeModal, setShowEditNodeModal] = useState(false);
 const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
 const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
 const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
 const [headerImgError, setHeaderImgError] = useState(false);
 const [modelTestResults, setModelTestResults] = useState<Record<string, string>>({});
 const [modelsTestError, setModelsTestError] = useState("");
 const [testingModelId, setTestingModelId] = useState<string | null>(null);
 const [showAddCustomModel, setShowAddCustomModel] = useState(false);
 const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
 const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
 const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
 const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
 const [providerStickyLimit, setProviderStickyLimit] = useState("");
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [thinkingMode, setThinkingMode] = useState("auto");
 const [suggestedModels, setSuggestedModels] = useState<any[]>([]);
 const [kiloFreeModels, setKiloFreeModels] = useState<Model[]>([]);
 const { copied, copy } = useCopyToClipboard();

 const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
 const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
 const isCompatible = isOpenAICompatible || isAnthropicCompatible;

 const providerInfo: any = providerNode
 ? {
 id: providerNode.id,
 name: providerNode.name || (providerNode.type ==="anthropic-compatible"?"Anthropic Compatible":"OpenAI Compatible"),
 color: providerNode.type ==="anthropic-compatible"?"#D97757":"#10A37F",
 textIcon: providerNode.type ==="anthropic-compatible"?"AC":"OC",
 apiType: providerNode.apiType,
 baseUrl: providerNode.baseUrl,
 type: providerNode.type,
 }
 : ((OAUTH_PROVIDERS as any)[providerId] || (APIKEY_PROVIDERS as any)[providerId] || (FREE_PROVIDERS as any)[providerId] || (FREE_TIER_PROVIDERS as any)[providerId]);
 
 const isOAuth = !!(OAUTH_PROVIDERS as any)[providerId] || !!(FREE_PROVIDERS as any)[providerId];
 const isFreeNoAuth = !!(FREE_PROVIDERS as any)[providerId]?.noAuth;
 const models = getModelsByProviderId(providerId);
 const providerAlias = getProviderAlias(providerId);
 
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const thinkingConfig = (AI_PROVIDERS as any)[providerId]?.thinkingConfig || THINKING_CONFIG.extended;
 
 const providerStorageAlias = isCompatible ? providerId : providerAlias;
 const providerDisplayAlias = isCompatible
 ? (providerNode?.prefix || providerId)
 : providerAlias;

 // Define callbacks BEFORE the useEffect that uses them
 const fetchAliases = useCallback(async () => {
 try {
 const res = await fetch("/api/models/alias");
 const data = await res.json();
 if (res.ok) {
 setModelAliases(data.aliases || {});
 }
 } catch (error) {
 console.log("Error fetching aliases:", error);
 }
 }, []);

 // Fetch free models from Kilo API for kilocode provider
 useEffect(() => {
 if (providerId !=="kilocode") return;
 fetch("/api/providers/kilo/free-models")
 .then((res) => res.json())
 .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
 .catch(() => {});
 }, [providerId]);

 const fetchConnections = useCallback(async () => {
 try {
 const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
 fetch("/api/providers", { cache:"no-store"}),
 fetch("/api/provider-nodes", { cache:"no-store"}),
 fetch("/api/proxy-pools?isActive=true", { cache:"no-store"}),
 fetch("/api/settings", { cache:"no-store"}),
 ]);
 const connectionsData = await connectionsRes.json();
 const nodesData = await nodesRes.json();
 const proxyPoolsData = await proxyPoolsRes.json();
 const settingsData = settingsRes.ok ? await settingsRes.json() : {};
 if (connectionsRes.ok) {
 const filtered = (connectionsData.connections || []).filter((c: any) => c.provider === providerId);
 setConnections(filtered);
 }
 if (proxyPoolsRes.ok) {
 setProxyPools(proxyPoolsData.proxyPools || []);
 }
 // Load per-provider strategy override
 const override = (settingsData.providerStrategies || {})[providerId] || {};
 setProviderStrategy(override.fallbackStrategy || null);
 setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) :"1");
 // Load per-provider thinking config
 const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
 setThinkingMode(thinkingCfg.mode ||"auto");
 if (nodesRes.ok) {
 let node = (nodesData.nodes || []).find((entry: any) => entry.id === providerId) || null;

 // Newly created compatible nodes can be briefly unavailable on one worker.
 // Retry a few times before showing"Provider not found".
 if (!node && isCompatible) {
 for (let attempt = 0; attempt < 3; attempt += 1) {
 await new Promise((resolve) => setTimeout(resolve, 150));
 const retryRes = await fetch("/api/provider-nodes", { cache:"no-store"});
 if (!retryRes.ok) continue;
 const retryData = await retryRes.json();
 node = (retryData.nodes || []).find((entry: any) => entry.id === providerId) || null;
 if (node) break;
 }
 }

 setProviderNode(node);
 }
 } catch (error) {
 console.log("Error fetching connections:", error);
 } finally {
 setLoading(false);
 }
 }, [providerId, isCompatible]);

 const handleUpdateNode = async (formData: any) => {
 try {
 const res = await fetch(`/api/provider-nodes/${providerId}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify(formData),
 });
 const data = await res.json();
 if (res.ok) {
 setProviderNode(data.node);
 await fetchConnections();
 setShowEditNodeModal(false);
 }
 } catch (error) {
 console.log("Error updating provider node:", error);
 }
 };

 const saveProviderStrategy = async (strategy: string | null, stickyLimit: string) => {
 try {
 const settingsRes = await fetch("/api/settings", { cache:"no-store"});
 const settingsData = settingsRes.ok ? await settingsRes.json() : {};
 const current = settingsData.providerStrategies || {};

 // Build override: null strategy means remove override, use global
 const override: any = {};
 if (strategy) override.fallbackStrategy = strategy;
 if (strategy ==="round-robin"&& stickyLimit !=="") {
 override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
 }

 const updated = { ...current };
 if (Object.keys(override).length === 0) {
 delete updated[providerId];
 } else {
 updated[providerId] = override;
 }

 await fetch("/api/settings", {
 method:"PATCH",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ providerStrategies: updated }),
 });
 } catch (error) {
 console.log("Error saving provider strategy:", error);
 }
 };

 const handleRoundRobinToggle = (enabled: boolean) => {
 const strategy = enabled ?"round-robin": null;
 const sticky = enabled ? (providerStickyLimit ||"1") : providerStickyLimit;
 if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
 setProviderStrategy(strategy);
 saveProviderStrategy(strategy, sticky);
 };

 const handleStickyLimitChange = (value: string) => {
 setProviderStickyLimit(value);
 saveProviderStrategy("round-robin", value);
 };

 const saveThinkingConfig = async (mode: string) => {
 try {
 const settingsRes = await fetch("/api/settings", { cache:"no-store"});
 const settingsData = settingsRes.ok ? await settingsRes.json() : {};
 const current = settingsData.providerThinking || {};
 const updated = { ...current };
 if (!mode || mode ==="auto") {
 delete updated[providerId];
 } else {
 updated[providerId] = { mode };
 }
 await fetch("/api/settings", {
 method:"PATCH",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ providerThinking: updated }),
 });
 } catch (error) {
 console.error("Error saving thinking config:", error);
 }
 };

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const handleThinkingModeChange = (mode: string) => {
 setThinkingMode(mode);
 saveThinkingConfig(mode);
 };

 useEffect(() => {
 fetchConnections();
 fetchAliases();
 }, [fetchConnections, fetchAliases]);

 // Fetch suggested models from provider's public API (if configured)
 useEffect(() => {
 const fetcher = ((OAUTH_PROVIDERS as any)[providerId] || (APIKEY_PROVIDERS as any)[providerId] || (FREE_PROVIDERS as any)[providerId] || (FREE_TIER_PROVIDERS as any)[providerId])?.modelsFetcher;
 if (!fetcher) return;
 fetchSuggestedModels(fetcher).then(setSuggestedModels);
 }, [providerId]);

 const handleSetAlias = async (modelId: string, alias: string, providerAliasOverride = providerAlias) => {
 const fullModel = `${providerAliasOverride}/${modelId}`;
 try {
 const res = await fetch("/api/models/alias", {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ model: fullModel, alias }),
 });
 if (res.ok) {
 await fetchAliases();
 } else {
 const data = await res.json();
 alert(data.error ||"Failed to set alias");
 }
 } catch (error) {
 console.log("Error setting alias:", error);
 }
 };

 const handleDeleteAlias = async (alias: string) => {
 try {
 const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
 method:"DELETE",
 });
 if (res.ok) {
 await fetchAliases();
 }
 } catch (error) {
 console.log("Error deleting alias:", error);
 }
 };

 const handleDelete = async (id: string) => {
 if (!confirm("Delete this connection?")) return;
 try {
 const res = await fetch(`/api/providers/${id}`, { method:"DELETE"});
 if (res.ok) {
 setConnections(connections.filter(c => c.id !== id));
 }
 } catch (error) {
 console.log("Error deleting connection:", error);
 }
 };

 const handleOAuthSuccess = () => {
 fetchConnections();
 setShowOAuthModal(false);
 };

 const handleIFlowCookieSuccess = () => {
 fetchConnections();
 setShowIFlowCookieModal(false);
 };

 const handleSaveApiKey = async (formData: any) => {
 try {
 const res = await fetch("/api/providers", {
 method:"POST",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ provider: providerId, ...formData }),
 });
 if (res.ok) {
 await fetchConnections();
 setShowAddApiKeyModal(false);
 }
 } catch (error) {
 console.log("Error saving connection:", error);
 }
 };

 const handleUpdateConnection = async (formData: any) => {
 if (!selectedConnection) return;
 try {
 const res = await fetch(`/api/providers/${selectedConnection.id}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify(formData),
 });
 if (res.ok) {
 await fetchConnections();
 setShowEditModal(false);
 }
 } catch (error) {
 console.log("Error updating connection:", error);
 }
 };

 const handleUpdateConnectionStatus = async (id: string, isActive: boolean) => {
 try {
 const res = await fetch(`/api/providers/${id}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ isActive }),
 });
 if (res.ok) {
 setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
 }
 } catch (error) {
 console.log("Error updating connection status:", error);
 }
 };

 const handleSwapPriority = async (index1: number, index2: number) => {
 // Optimistic update state
 const newConnections = [...connections];
 [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
 setConnections(newConnections);

 try {
 await Promise.all([
 fetch(`/api/providers/${newConnections[index1].id}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ priority: index1 }),
 }),
 fetch(`/api/providers/${newConnections[index2].id}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ priority: index2 }),
 }),
 ]);
 } catch (error) {
 console.log("Error swapping priority:", error);
 await fetchConnections();
 }
 };

 const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const toggleSelectConnection = (connectionId: string) => {
 setSelectedConnectionIds((prev) => (
 prev.includes(connectionId)
 ? prev.filter((id) => id !== connectionId)
 : [...prev, connectionId]
 ));
 };

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const toggleSelectAllConnections = () => {
 if (allSelected) {
 setSelectedConnectionIds([]);
 return;
 }
 setSelectedConnectionIds(connections.map((conn) => conn.id));
 };

 const clearSelection = () => {
 setSelectedConnectionIds([]);
 setBulkProxyPoolId("__none__");
 };

 useEffect(() => {
 setSelectedConnectionIds((prev) => {
 const next = prev.filter((id) => connections.some((conn) => conn.id === id));
 if (next.length === prev.length) return prev;
 return next;
 });
 }, [connections]);

 const selectedProxySummary = (() => {
 if (selectedConnections.length === 0) return"";
 const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId ||"__none__"));
 if (poolIds.size === 1) {
 const onlyId = [...poolIds][0];
 if (onlyId ==="__none__") return"All selected currently unbound";
 const pool = proxyPools.find((p) => p.id === onlyId);
 return `All selected currently bound to ${pool?.name || onlyId}`;
 }
 return"Selected connections have mixed proxy bindings";
 })();

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const openBulkProxyModal = () => {
 if (selectedConnections.length === 0) return;
 const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId ||"__none__"))];
 setBulkProxyPoolId(uniquePoolIds.length === 1 ? (uniquePoolIds[0] as string) :"__none__");
 setShowBulkProxyModal(true);
 };

 const closeBulkProxyModal = () => {
 if (bulkUpdatingProxy) return;
 setShowBulkProxyModal(false);
 };

 const handleBulkApplyProxyPool = async () => {
 if (selectedConnectionIds.length === 0) return;

 const proxyPoolId = bulkProxyPoolId ==="__none__"? null : bulkProxyPoolId;
 setBulkUpdatingProxy(true);
 try {
 const results = [];
 for (const connectionId of selectedConnectionIds) {
 try {
 const res = await fetch(`/api/providers/${connectionId}`, {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ proxyPoolId }),
 });
 results.push(res.ok);
 } catch (e) {
 console.log("Error applying bulk proxy pool for", connectionId, e);
 results.push(false);
 }
 }

 const failedCount = results.filter((ok) => !ok).length;
 if (failedCount > 0) {
 alert(`Updated with ${failedCount} failed request(s).`);
 }

 await fetchConnections();
 clearSelection();
 setShowBulkProxyModal(false);
 } catch (error) {
 console.log("Error applying bulk proxy pool:", error);
 } finally {
 setBulkUpdatingProxy(false);
 }
 };


 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const isSelected = (connectionId: string) => selectedConnectionIds.includes(connectionId);

 const connectionsList = (
 <div className="flex flex-col divide-y divide-border">
 {connections
 .map((conn, index) => (
 <div key={conn.id} className="flex items-stretch">
 <div className="flex-1 min-w-0">
 <ConnectionRow
 connection={conn}
 proxyPools={proxyPools}
 isOAuth={isOAuth}
 isFirst={index === 0}
 isLast={index === connections.length - 1}
 onMoveUp={() => handleSwapPriority(index, index - 1)}
 onMoveDown={() => handleSwapPriority(index, index + 1)}
 onEdit={() => {
 setSelectedConnection(conn);
 setShowEditModal(true);
 }}
 onDelete={() => handleDelete(conn.id)}
 />
 </div>
 </div>
 ))}
 </div>
 );

 const bulkProxyOptions = [
 { value:"__none__", label:"None"},
 ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
 ];

 const bulkHint = selectedConnectionIds.length === 0
 ?"Select one or more connections, then click Proxy Action."
 : selectedProxySummary;

 const canApplyBulkProxy = selectedConnectionIds.length > 0 && !bulkUpdatingProxy;

 const bulkActionModal = (
 <Dialog
 open={showBulkProxyModal}
 onOpenChange={(open) => {
 if (!open) closeBulkProxyModal();
 }}
 >
 <DialogContent className="sm:max-w-md rounded-none border-border/50 shadow-none">
 <DialogHeader>
 <DialogTitle className="uppercase tracking-tight">
 Proxy Action ({selectedConnectionIds.length} selected)
 </DialogTitle>
 </DialogHeader>
 <div className="flex flex-col gap-4 py-2">
 <div className="flex flex-col gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Proxy Pool</Label>
 <Select
 value={bulkProxyPoolId}
 onValueChange={(v) => setBulkProxyPoolId(v as string)}
 >
 <SelectTrigger className="w-full rounded-none border-border/50 bg-muted/5 h-9 text-xs shadow-none">
 <SelectValue placeholder="None"/>
 </SelectTrigger>
 <SelectContent className="rounded-none shadow-none border-border/50">
 {bulkProxyOptions.map((opt) => (
 <SelectItem key={opt.value} value={opt.value} className="rounded-none text-xs font-medium">
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">{bulkHint}</p>
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
 Selecting None will unbind selected connections from proxy pool.
 </p>
 </div>
 <DialogFooter className="gap-2 sm:gap-2 mt-4 p-0">
 <Button
 type="button"
 variant="outline"
 className="font-bold text-[10px] uppercase tracking-widest flex-1 h-10 rounded-none border-border/50"
 onClick={closeBulkProxyModal}
 disabled={bulkUpdatingProxy}
 >
 Cancel
 </Button>
 <Button
 type="button"
 className="font-bold text-[10px] uppercase tracking-widest flex-1 h-10 rounded-none shadow-none"
 onClick={handleBulkApplyProxyPool}
 disabled={!canApplyBulkProxy}
 >
 {bulkUpdatingProxy ? (
 <>
 <CircleNotch className="size-4 animate-spin mr-1.5" weight="bold" />
 Applying...
 </>
 ) : (
"Apply"
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );

 const handleTestModel = async (modelId: string) => {
 if (testingModelId) return;
 setTestingModelId(modelId);
 try {
 const res = await fetch("/api/models/test", {
 method:"POST",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
 });
 const data = await res.json();
 setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ?"ok":"error"}));
 setModelsTestError(data.ok ?"": (data.error ||"Model not reachable"));
 } catch {
 setModelTestResults((prev) => ({ ...prev, [modelId]:"error"}));
 setModelsTestError("Network error");
 } finally {
 setTestingModelId(null);
 }
 };

 const renderModelsSection = () => {
 if (isCompatible) {
 return (
 <CompatibleModelsSection
 providerStorageAlias={providerStorageAlias as string}
 providerDisplayAlias={providerDisplayAlias as string}
 modelAliases={modelAliases}
 copied={copied}
 onCopy={copy}
 onSetAlias={handleSetAlias}
 onDeleteAlias={handleDeleteAlias}
 connections={connections}
 isAnthropic={isAnthropicCompatible}
 />
 );
 }
 // Combine hardcoded models with Kilo free models (deduplicated)
 // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
 const displayModels = [
 ...models,
 ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
 ].filter((m: any) => !m.type || m.type ==="llm");
 // Custom models added by user (stored as aliases: modelId → providerAlias/modelId)
 const customModels = Object.entries(modelAliases)
 .filter(([alias, fullModel]) => {
 const prefix = `${providerStorageAlias}/`;
 if (!fullModel.startsWith(prefix)) return false;
 const modelId = fullModel.slice(prefix.length);
 // Only show if not already in hardcoded list
 // For passthroughModels, include all aliases (model IDs may contain slashes like"anthropic/claude-3")
 if (providerInfo?.passthroughModels) return !models.some((m) => m.id === modelId);
 return !models.some((m) => m.id === modelId) && alias === modelId;
 })
 .map(([alias, fullModel]) => ({
 id: fullModel.slice(`${providerStorageAlias}/`.length),
 alias,
 fullModel,
 }));

 return (
 <div className="flex flex-wrap gap-3">
 {displayModels.map((model: any) => {
 const fullModel = `${providerStorageAlias}/${model.id}`;
 const oldFormatModel = `${providerId}/${model.id}`;
 const existingAlias = Object.entries(modelAliases).find(
 ([, m]) => m === fullModel || m === oldFormatModel
 )?.[0];
 return (
 <ModelRow
 key={model.id}
 model={model}
 fullModel={`${providerDisplayAlias}/${model.id}`}
 alias={existingAlias}
 copied={copied}
 onCopy={copy}
 onDeleteAlias={() => existingAlias && handleDeleteAlias(existingAlias)}
 testStatus={modelTestResults[model.id] as any}
 onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
 isTesting={testingModelId === model.id}
 isFree={model.isFree}
 />
 );
 })}

 {/* Custom models inline */}
 {customModels.map((model) => (
 <ModelRow
 key={model.id}
 model={{ id: model.id }}
 fullModel={`${providerDisplayAlias}/${model.id}`}
 alias={model.alias}
 copied={copied}
 onCopy={copy}
 onDeleteAlias={() => handleDeleteAlias(model.alias)}
 testStatus={modelTestResults[model.id] as any}
 onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
 isTesting={testingModelId === model.id}
 isCustom
 />
 ))}

 {/* Add model button — inline, same style as model chips */}
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={() => setShowAddCustomModel(true)}
 className="h-auto border-dashed py-2 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/60 hover:bg-primary/5 hover:text-primary transition-all"
 >
 <Plus className="size-3.5 mr-1.5" weight="bold" />
 Add Model
 </Button>

 {/* Suggested models from provider API — show only models not yet added */}
 {suggestedModels.length > 0 && (() => {
 const addedFullModels = new Set(Object.values(modelAliases));
 const hardcodedIds = new Set(models.map((m) => m.id));
 const notAdded = suggestedModels.filter(
 (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
 );
 if (notAdded.length === 0) return null;
 return (
 <div className="mt-2 w-full">
 <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">
 {translate("Suggested free models")} (<span className="tabular-nums">≥200k</span> context):
 </p>
 <div className="flex flex-wrap gap-2">
 {notAdded.map((m) => (
 <Button
 key={m.id}
 type="button"
 variant="outline"
 size="sm"
 onClick={async () => {
 const alias = m.id.split("/").pop();
 await handleSetAlias(m.id, alias as string, providerStorageAlias);
 }}
 className="h-auto px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background hover:bg-muted/10 transition-colors"
 title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
 >
 <Plus className="size-3 mr-1.5" weight="bold" />
 {m.id.split("/").pop()}
 </Button>
 ))}
 </div>
 </div>
 );
 })()}
 </div>
 );
 };

 if (loading) {
 return (
 <div className="mx-auto max-w-5xl flex flex-col gap-8 pb-10 px-4 animate-pulse">
 <div className="space-y-3 py-4">
 <Skeleton className="h-4 w-32 rounded-none opacity-40"/>
 <Skeleton className="h-10 w-2/3 max-w-md rounded-none"/>
 </div>
 <Skeleton className="h-24 w-full rounded-none border border-border/40"/>
 <Skeleton className="h-64 w-full rounded-none border border-border/40"/>
 </div>
 );
 }

 if (!providerInfo) {
 return (
 <div className="py-20 text-center flex flex-col items-center gap-6 opacity-40 grayscale">
 <ShieldCheck className="size-16" weight="bold" />
 <div className="space-y-1">
 <h2 className="text-xl font-bold tracking-tight uppercase">Provider Not Found</h2>
 <p className="text-xs font-medium italic">Identity check failed in the registry.</p>
 </div>
 <Link
 href="/dashboard/providers"
 className={cn(buttonVariants({ variant:"outline", size: "sm" }), "rounded-none border-border/50 uppercase font-bold text-[10px] tracking-widest px-6")}
 >
 Back to Registry
 </Link>
 </div>
 );
 }

 // Determine icon path: OpenAI Compatible providers use specialized icons
 const getHeaderIconPath = () => {
 if (isOpenAICompatible && providerInfo.apiType) {
 return providerInfo.apiType ==="responses"?"/providers/oai-r.png":"/providers/oai-cc.png";
 }
 if (isAnthropicCompatible) {
 return"/providers/anthropic-m.png";
 }
 return `/providers/${providerInfo.id}.png`;
 };

 return (
 <div className="mx-auto max-w-5xl flex flex-col gap-6 py-4 px-4 pb-12">
 {/* Page Header */}
 <header className="flex flex-col gap-3 pb-6 border-b border-border/50">
 <Link
 href="/dashboard/providers"
 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors group"
 >
 <ArrowLeft className="size-3.5 group-hover:-translate-x-0.5 transition-transform" weight="bold" />
 {translate("Back to Providers")}
 </Link>

 <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mt-2">
 <div className="flex items-center gap-5">
 <div
 className="size-14 rounded-none flex items-center justify-center border border-border/50 bg-muted/5 shadow-none"
 style={{ backgroundColor: `${providerInfo.color}08` }}
 >
 {headerImgError ? (
 <span className="text-xl font-bold" style={{ color: providerInfo.color }}>
 {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
 </span>
 ) : (
 <Image
 src={getHeaderIconPath()}
 alt={providerInfo.name}
 width={36}
 height={36}
 className={cn(
 "object-contain max-w-[32px] max-h-[32px]",
 (providerInfo.id === "codex" || providerInfo.id === "openai" || providerInfo.id === "github") && "dark:invert"
 )}
 sizes="36px"
 onError={() => setHeaderImgError(true)}
 />
 )}
 </div>
 <div className="flex flex-col gap-0.5">
 <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[10px] uppercase tracking-widest opacity-60">
 <ShieldCheck className="size-3.5" weight="bold" />
 {translate("Infrastructure")}
 </div>
 <h1 className="text-2xl font-bold tracking-tight uppercase leading-none">{providerInfo.name}</h1>
 <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-1.5 tabular-nums">
 {connections.length} {translate(connections.length === 1 ? "connection" : "connections")} active
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2">
 {isOAuth && (
 <Button 
 type="button"
 variant="outline" 
 size="sm" 
 onClick={() => setShowOAuthModal(true)} 
 className="font-bold text-[10px] uppercase tracking-widest h-8 px-5 rounded-none border-border/50 bg-background"
 >
 <Plus className="size-3.5 mr-1.5" weight="bold" />
 {providerId === "iflow" ? "OAuth" : translate("Add Connection")}
 </Button>
 )}
 {!isOAuth && !isFreeNoAuth && !isCompatible && (
 <Button 
 type="button"
 variant="outline" 
 size="sm" 
 onClick={() => setShowAddApiKeyModal(true)} 
 className="font-bold text-[10px] uppercase tracking-widest h-8 px-5 rounded-none border-border/50 bg-background"
 >
 <Plus className="size-3.5 mr-1.5" weight="bold" />
 {translate("Add Connection")}
 </Button>
 )}
 </div>
 </div>
 </header>

 {providerInfo.deprecated && (
 <Alert variant="destructive" className="border-orange-500/40 bg-orange-500/5 rounded-none p-4">
 <Warning className="text-orange-500 size-5" weight="bold" />
 <AlertTitle className="text-orange-600 font-bold uppercase tracking-widest text-xs">{translate("Deprecated")}</AlertTitle>
 <AlertDescription className="text-orange-600/80 text-[11px] font-medium leading-relaxed italic mt-1">
 {providerInfo.deprecationNotice}
 </AlertDescription>
 </Alert>
 )}

 {providerInfo.notice && !providerInfo.deprecated && (
 <Alert className="border-primary/40 bg-primary/5 rounded-none p-4">
 <Info className="text-primary size-5" weight="bold" />
 <AlertDescription className="text-primary/80 text-[11px] font-medium leading-relaxed italic">
 {providerInfo.notice.text}
 </AlertDescription>
 {providerInfo.notice.apiKeyUrl && (
 <div className="mt-3">
 <a
 href={providerInfo.notice.apiKeyUrl}
 target="_blank"
 rel="noopener noreferrer"
 className={cn(
 buttonVariants({ size: "xs", variant: "secondary" }),
 "font-bold text-[9px] uppercase tracking-widest bg-primary/20 text-primary border-none hover:bg-primary/30 rounded-none",
 )}
 >
 Get API Key
 </a>
 </div>
 )}
 </Alert>
 )}

 {isCompatible && providerNode && (
 <Card className="p-4 rounded-none bg-muted/5 border-border/50 shadow-none">
 <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
 <div className="min-w-0 flex flex-col gap-1">
 <h2 className="text-xs font-bold uppercase tracking-widest text-foreground opacity-60">
 {isAnthropicCompatible
 ? translate("Anthropic Compatible Parameters")
 : translate("OpenAI Compatible Parameters")}
 </h2>
 <div className="text-xs font-mono text-muted-foreground tabular-nums bg-background/50 p-2 rounded-none border border-border/40 truncate">
 <span className="text-primary font-bold mr-2 uppercase">
 {isAnthropicCompatible
 ?"Messages API"
 : providerNode.apiType ==="responses"
 ?"Responses API"
 :"Chat Completions"}
 </span>
 · {(providerNode.baseUrl ||"").replace(/\/$/,"")}/
 {isAnthropicCompatible
 ?"messages"
 : providerNode.apiType ==="responses"
 ?"responses"
 :"chat/completions"}
 </div>
 </div>
 <div className="flex shrink-0 flex-wrap items-center gap-2 mt-1">
 <Button
 size="xs"
 variant="outline"
 onClick={() => setShowAddApiKeyModal(true)}
 disabled={connections.length > 0}
 className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background"
 >
 <Plus className="size-3.5 mr-1.5" weight="bold" />
 {translate("Add")}
 </Button>
 <Button
 size="xs"
 variant="secondary"
 onClick={() => setShowEditNodeModal(true)}
 className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none bg-muted/20 border-border/50"
 >
 <Pencil className="size-3.5 mr-1.5" weight="bold" />
 {translate("Edit")}
 </Button>
 <Button
 size="xs"
 variant="secondary"
 onClick={async () => {
 if (
 !confirm(
 translate(`Delete this ${isAnthropicCompatible ?"Anthropic":"OpenAI"} Compatible node?`),
 )
 )
 return;
 try {
 const res = await fetch(`/api/provider-nodes/${providerId}`, {
 method:"DELETE",
 });
 if (res.ok) {
 router.push("/dashboard/providers");
 }
 } catch (error) {
 console.log("Error deleting provider node:", error);
 }
 }}
 className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none text-destructive bg-destructive/5 hover:bg-destructive/10 border-border/50"
 >
 <Trash className="size-3.5 mr-1.5" weight="bold" />
 {translate("Delete")}
 </Button>
 </div>
 </div>
 {connections.length > 0 && (
 <p className="text-[10px] text-muted-foreground mt-3 font-medium italic opacity-60 flex items-center gap-1.5">
 <Info className="size-3" weight="bold" />
 {translate("Only one connection is allowed per compatible node.")}
 </p>
 )}
 </Card>
 )}

 {/* Connections */}
 {isFreeNoAuth ? (
 <Card className="p-5 border-primary/20 bg-primary/5 rounded-none shadow-none">
 <div className="flex items-center gap-4">
 <div className="inline-flex size-11 items-center justify-center rounded-none bg-primary/10 text-primary border border-primary/20">
 <LockOpen className="size-6" weight="bold" />
 </div>
 <div className="flex flex-col gap-0.5">
 <p className="text-sm font-bold uppercase tracking-tight text-foreground">{translate("Stateless Protocol Active")}</p>
 <p className="text-xs text-muted-foreground font-medium italic opacity-70">
 {translate("This infrastructure provider requires no authentication and is ready for traffic.")}
 </p>
 </div>
 </div>
 </Card>
 ) : (
 <Card className="border-border/50 shadow-none overflow-hidden p-0 py-0 rounded-none bg-background/50">
 <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-border/50 bg-muted/10">
 <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground opacity-40">
 {translate("Active Link Registry")}
 </CardTitle>
 <div className="flex flex-wrap items-center gap-6">
 <div className="flex items-center gap-2.5">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {translate("Load Balance")}
 </span>
 <Switch
 checked={providerStrategy === "round-robin"}
 onCheckedChange={handleRoundRobinToggle}
 className="scale-75 data-[state=checked]:bg-primary"
 />
 {providerStrategy === "round-robin" && (
 <div className="flex items-center gap-2 ml-2 animate-in fade-in duration-300">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Stickiness:</span>
 <Input
 type="number"
 min={1}
 value={providerStickyLimit}
 onChange={(e) => handleStickyLimitChange(e.target.value)}
 placeholder="1"
 className="h-7 w-12 px-1 py-0.5 text-xs font-bold tabular-nums text-center bg-background border-border/50 rounded-none shadow-inner"
 />
 </div>
 )}
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-0">
 {connections.length === 0 ? (
 <div className="py-16 text-center flex flex-col items-center justify-center opacity-10 grayscale gap-3">
 <div className="mb-2 inline-flex size-14 items-center justify-center rounded-none bg-muted/10 border border-border/40">
 {isOAuth ? <Lock className="size-8" weight="bold" /> : <Key className="size-8" weight="bold" />}
 </div>
 <div className="space-y-1">
 <p className="text-xs font-bold uppercase tracking-[0.3em]">{translate("No connections provisioned")}</p>
 <p className="text-[10px] font-medium italic opacity-60">{translate("Initialize your first security credential to begin routing.")}</p>
 </div>
 {!isCompatible && (
 <div className="flex justify-center gap-3 mt-6">
 {providerId === "iflow" && (
 <Button 
 type="button"
 variant="secondary" 
 size="sm" 
 onClick={() => setShowIFlowCookieModal(true)} 
 className="font-bold text-[10px] uppercase tracking-widest h-9 px-5 rounded-none"
 >
 <Cookie className="size-4 mr-1.5" weight="bold" />
 Cookie Auth
 </Button>
 )}
 <Button 
 type="button"
 variant="outline" 
 size="sm" 
 onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)} 
 className="font-bold text-[10px] uppercase tracking-widest h-9 px-5 rounded-none border-border/50 bg-background"
 >
 <Plus className="size-4 mr-1.5" weight="bold" />
 {providerId === "iflow" ? "OAuth" : translate("Provision link")}
 </Button>
 </div>
 )}
 </div>
 ) : (
 <div className="divide-y divide-border/20">
 {connectionsList}
 </div>
 )}
 </CardContent>
 
 {!isCompatible && connections.length > 0 && (
 <CardFooter className="px-4 py-2 border-t border-border/40 bg-muted/5 rounded-none justify-end">
 <div className="flex gap-2">
 {providerId === "iflow" && (
 <Button size="xs" variant="secondary" onClick={() => setShowIFlowCookieModal(true)} className="h-7 px-3 text-[9px] font-bold uppercase tracking-widest rounded-none">
 <Cookie className="size-3 mr-1.5" weight="bold" />
 Cookie
 </Button>
 )}
 <Button size="xs" variant="outline" onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)} className="h-7 px-3 text-[9px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background">
 <Plus className="size-3 mr-1.5" weight="bold" />
 {translate("Add")}
 </Button>
 </div>
 </CardFooter>
 )}
 </Card>
 )}

 {/* Models */}
 <Card className="border-border/50 shadow-none overflow-hidden p-0 py-0 rounded-none bg-background/50">
 <CardHeader className="px-4 py-3 border-b border-border/50 bg-muted/10">
 <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground opacity-40">
 {translate("Acoustic & Intelligence Spectrum")}
 </CardTitle>
 </CardHeader>
 <CardContent className="p-4">
 {!!modelsTestError && (
 <Alert variant="destructive" className="mb-4 border-destructive/20 bg-destructive/5 py-2 rounded-none">
 <Warning className="size-4 text-destructive" weight="bold" />
 <AlertDescription className="text-[10px] font-bold uppercase tracking-wide text-destructive">
 {modelsTestError}
 </AlertDescription>
 </Alert>
 )}
 {renderModelsSection()}
 </CardContent>
 </Card>


 {bulkActionModal}

 {/* Modals */}
 {providerId ==="kiro"? (
 <KiroOAuthWrapper
 isOpen={showOAuthModal}
 providerInfo={providerInfo}
 onSuccess={handleOAuthSuccess}
 onClose={() => setShowOAuthModal(false)}
 />
 ) : providerId ==="cursor"? (
 <CursorAuthModal
 open={showOAuthModal}
 onSuccess={handleOAuthSuccess}
 onClose={() => setShowOAuthModal(false)}
 />
 ) : providerId ==="gitlab"? (
 <GitLabAuthModal
 isOpen={showOAuthModal}
 providerInfo={providerInfo}
 onSuccess={handleOAuthSuccess}
 onClose={() => setShowOAuthModal(false)}
 />
 ) : (
 <OAuthModal
 open={showOAuthModal}
 provider={providerId}
 providerInfo={providerInfo}
 onSuccess={handleOAuthSuccess}
 onClose={() => setShowOAuthModal(false)}
 />
 )}
 {providerId ==="iflow"&& (
 <IFlowCookieModal
 isOpen={showIFlowCookieModal}
 onSuccess={handleIFlowCookieSuccess}
 onClose={() => setShowIFlowCookieModal(false)}
 />
 )}
 <AddApiKeyModal
 isOpen={showAddApiKeyModal}
 provider={providerId}
 providerName={providerInfo?.name || providerId}
 isCompatible={isCompatible}
 isAnthropic={isAnthropicCompatible}
 proxyPools={proxyPools}
 onSave={handleSaveApiKey}
 onClose={() => setShowAddApiKeyModal(false)}
 />
 <EditConnectionModal
 isOpen={showEditModal}
 connection={selectedConnection}
 proxyPools={proxyPools}
 onSave={handleUpdateConnection}
 onClose={() => setShowEditModal(false)}
 />
 {isCompatible && (
 <EditCompatibleNodeModal
 isOpen={showEditNodeModal}
 node={providerNode}
 onSave={handleUpdateNode}
 onClose={() => setShowEditNodeModal(false)}
 isAnthropic={isAnthropicCompatible}
 />
 )}
 {!isCompatible && (
 <AddCustomModelModal
 isOpen={showAddCustomModel}
 providerAlias={providerStorageAlias as string}
 providerDisplayAlias={providerDisplayAlias as string}
 onSave={async (modelId: string) => {
 // For passthrough providers (OpenRouter), use last segment as alias to avoid slash conflicts
 const alias = providerInfo?.passthroughModels
 ? modelId.split("/").pop()
 : modelId;
 await handleSetAlias(modelId, alias as string, providerStorageAlias);
 setShowAddCustomModel(false);
 }}
 onClose={() => setShowAddCustomModel(false)}
 />
 )}
 </div>
 );
}

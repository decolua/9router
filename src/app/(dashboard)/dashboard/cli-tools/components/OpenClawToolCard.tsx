"use client";

import React, { useState, useEffect, useRef } from "react";
import { BaseToolCard } from "./";
import { 
  Button, 
  Input, 
  ManualConfigModal, 
  ModelSelectModal,
} from "@/shared/components";
import { 
  ArrowsClockwise as RotateCcw, 
  ShieldCheck, 
  Info,
  X,
  ArrowRight
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface OpenClawStatus {
  installed: boolean;
  has8Router: boolean;
  settings?: {
    models?: {
      providers?: {
        "8router"?: {
          baseUrl: string;
        };
      };
    };
  };
  agents?: Array<{
    id: string;
    name?: string;
    agentDir?: string;
  }>;
}

interface OpenClawToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: any[];
  baseUrl: string;
  apiKeys: any[];
  cloudEnabled: boolean;
  initialStatus?: OpenClawStatus | null;
  hasActiveProviders: boolean;
}

export default function OpenClawToolCard({
 tool,
 isExpanded,
 onToggle,
 activeProviders,
 baseUrl,
 apiKeys,
 cloudEnabled,
 initialStatus,
 hasActiveProviders,
}: OpenClawToolCardProps) {
 const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatus | null>(initialStatus || null);
 const [checkingOpenclaw, setCheckingOpenclaw] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [selectedModel, setSelectedModel] = useState("");
 const [agentModels, setAgentModels] = useState<Record<string, string>>({});
 const [modalOpen, setModalOpen] = useState(false);
 const [agentModalFor, setAgentModalFor] = useState<string | null>(null);
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);
 const [modelAliases, setModelAliases] = useState({});
 const [customBaseUrl, setCustomBaseUrl] = useState("");
 const hasInitialized = useRef(false);

 const checkStatus = async () => {
 setCheckingOpenclaw(true);
 try {
 const res = await fetch("/api/cli-tools/openclaw-settings");
 const data = await res.json();
 setOpenclawStatus(data);
 if (!hasInitialized.current && data.settings) {
 // Load current settings if available
 hasInitialized.current = true;
 }
 } catch (err) {
 console.error("Error checking Open Claw status:", err);
 } finally {
 setCheckingOpenclaw(false);
 }
 };

 useEffect(() => {
 if (isExpanded && !openclawStatus) {
 checkStatus();
 }
 }, [isExpanded, openclawStatus]);

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 fetch("/api/models/alias").then(r => r.json()).then(d => setModelAliases(d.aliases || {}));
 }, []);

 const handleApply = async () => {
 if (!selectedModel) {
 setMessage({ type: "error", text: translate("Please select a default model first") });
 return;
 }
 setApplying(true);
 setMessage(null);
 try {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "" : "sk_8router"));
 const res = await fetch("/api/cli-tools/openclaw-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ 
   baseUrl: getDisplayUrl(), 
   apiKey: keyToUse, 
   model: selectedModel,
   agentModels 
 }),
 });

 if (res.ok) {
 setMessage({ type: "success", text: translate("Open Claw settings applied!") });
 await checkStatus();
 } else {
 const data = await res.json();
 setMessage({ type: "error", text: data.error || translate("Failed to apply settings") });
 }
 } catch (err: any) {
 setMessage({ type: "error", text: err.message });
 } finally {
 setApplying(false);
 }
 };

 const handleReset = async () => {
 if (!confirm(translate("Remove 8Router from Open Claw settings?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/openclaw-settings", { method: "DELETE" });
 if (res.ok) {
 setMessage({ type: "success", text: translate("8Router settings removed.") });
 await checkStatus();
 }
 } catch (err: any) {
 setMessage({ type: "error", text: err.message });
 } finally {
 setRestoring(false);
 }
 };

 const handleModelSelect = (model: any) => {
 if (agentModalFor) {
 setAgentModels(prev => ({ ...prev, [agentModalFor]: model.value }));
 } else {
 setSelectedModel(model.value);
 }
 setModalOpen(false);
 };

 const getLocalBaseUrl = () => baseUrl || "http://localhost:20128";
 const getDisplayUrl = () => customBaseUrl || getLocalBaseUrl();

 const getConfigStatus = () => {
 if (!openclawStatus?.installed) return "not_configured";
 const currentUrl = openclawStatus.settings?.models?.providers?.["8router"]?.baseUrl || "";
 const expectedUrl = getDisplayUrl();
 if (currentUrl.includes(expectedUrl) || expectedUrl.includes(currentUrl)) return "configured";
 return "other";
 };

 const getManualConfigs = () => {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "YOUR_API_KEY" : "sk_8router"));
 const normalizedBaseUrl = getDisplayUrl().endsWith("/v1") ? getDisplayUrl() : `${getDisplayUrl()}/v1`;
 
 const providerObj = {
  baseUrl: normalizedBaseUrl,
  apiKey: keyToUse,
  api: "openai-completions",
  models: [{ id: selectedModel || "provider/model-id", name: (selectedModel || "model-id").split("/").pop() }]
 };

 return [
  { filename: "settings.json (partial)", content: `"models": {\n  "providers": {\n    "8router": ${JSON.stringify(providerObj, null, 2)}\n  }\n}` },
  { filename: "agent/models.json", content: JSON.stringify({ providers: { "8router": providerObj } }, null, 2) }
 ];
 };

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={getConfigStatus()}
 checking={checkingOpenclaw}
 applying={applying}
 restoring={restoring}
 message={message}
 onApply={handleApply}
 onReset={handleReset}
 onCheckStatus={checkStatus}
 onShowManualConfig={() => setShowManualConfigModal(true)}
 hasActiveProviders={hasActiveProviders}
 >
 <div className="space-y-6">
 {!openclawStatus?.installed && (
 <div className="bg-muted/10 border border-border/50 rounded-xl p-4 flex items-start gap-3">
 <Info className="size-5 text-muted-foreground shrink-0 mt-0.5" weight="bold" />
 <p className="text-[11px] text-muted-foreground font-medium leading-relaxed italic">
 {translate("Open Claw CLI not detected. Settings will be written manually.")}
 </p>
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
 {/* Base URL */}
 <div className="space-y-2">
 <div className="flex items-center justify-between px-1">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Endpoint URL</label>
 {getConfigStatus() === "other" && openclawStatus?.settings?.models?.providers?.["8router"]?.baseUrl && (
 <span className="text-[9px] text-muted-foreground/60 italic tabular-nums truncate max-w-[200px]">Current: {openclawStatus.settings.models.providers["8router"].baseUrl}</span>
 )}
 </div>
 <div className="flex items-center gap-2">
 <Input 
 value={getDisplayUrl()} 
 onChange={(e) => setCustomBaseUrl(e.target.value)} 
 placeholder="http://localhost:20128"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50 transition-colors"
 />
 {customBaseUrl && customBaseUrl !== getLocalBaseUrl() && (
 <Button variant="ghost" size="icon" onClick={() => setCustomBaseUrl("")} className="size-9 text-muted-foreground hover:text-primary transition-colors border border-border/50 rounded-none bg-muted/5">
 <RotateCcw className="size-3.5" weight="bold" />
 </Button>
 )}
 </div>
 </div>

 {/* API Key */}
 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5 px-1">
 <Info className="size-3" weight="bold" />
 Access Token
 </label>
 {apiKeys?.length > 0 ? (
 <select 
 value={selectedApiKey} 
 onChange={(e) => setSelectedApiKey(e.target.value)} 
 className="w-full h-9 px-3 bg-muted/5 border border-border/50 rounded-none text-xs font-bold focus:outline-none focus:border-primary/50 transition-colors"
 >
 {apiKeys.map((key) => (
 <option key={key.id} value={key.key}>{key.key}</option>
 ))}
 </select>
 ) : (
 <div className="h-9 flex items-center px-3 bg-muted/10 border border-border/50 border-dashed rounded-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
 {cloudEnabled ? translate("NO ACTIVE KEYS") : "sk_8router (INTERNAL)"}
 </div>
 )}
 </div>

 {/* Default Model */}
 <div className="col-span-full space-y-4 pt-2">
 <div className="flex items-center gap-2 px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Primary Intelligence</span>
 <div className="h-px flex-1 bg-border/40"></div>
 </div>
 
 <div className="flex items-center gap-2">
 <Input 
 value={selectedModel} 
 onChange={(e) => setSelectedModel(e.target.value)} 
 placeholder="provider/model-id"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50 transition-colors flex-1"
 />
 <Button 
 variant="outline" 
 size="sm" 
 onClick={() => { setAgentModalFor(null); setModalOpen(true); }} 
 disabled={!hasActiveProviders}
 className="h-9 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors"
 >
 {translate("Select")}
 </Button>
 {selectedModel && (
 <Button variant="ghost" size="icon" onClick={() => setSelectedModel("")} className="size-9 rounded-none text-muted-foreground hover:text-destructive transition-colors border border-border/50 bg-muted/5">
 <X className="size-4" weight="bold" />
 </Button>
 )}
 </div>
 </div>

 {/* Per-agent overrides */}
 {openclawStatus?.agents && openclawStatus.agents.filter(a => a.agentDir).length > 0 && (
 <div className="col-span-full space-y-4 pt-6 border-t border-border/40">
 <div className="flex items-center gap-2 px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Agent-Specific Intelligence</span>
 <div className="h-px flex-1 bg-border/40"></div>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {openclawStatus.agents.filter(a => a.agentDir).map((agent) => (
 <div key={agent.id} className="space-y-2 bg-muted/5 p-3 border border-border/40">
 <div className="flex items-center justify-between">
 <span className="text-[10px] font-bold text-primary uppercase tracking-widest truncate max-w-[150px]" title={agent.name || agent.id}>
 {agent.name || agent.id}
 </span>
 <ArrowRight className="size-3 text-muted-foreground opacity-40" weight="bold" />
 </div>
 <div className="flex items-center gap-2 mt-1">
 <Input
 value={agentModels[agent.id] || ""}
 onChange={(e) => setAgentModels(prev => ({ ...prev, [agent.id]: e.target.value }))}
 placeholder={`Inherit Default (${selectedModel.split('/').pop() || "none"})`}
 className="h-8 text-[10px] rounded-none border-border/50 bg-background focus-visible:ring-0 focus-visible:border-primary/50 transition-colors flex-1"
 />
 <Button 
 variant="outline" 
 size="xs" 
 onClick={() => { setAgentModalFor(agent.id); setModalOpen(true); }} 
 disabled={!hasActiveProviders}
 className="h-8 px-2 text-[9px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background"
 >
 {translate("Set")}
 </Button>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={handleModelSelect}
 selectedModel={agentModalFor ? agentModels[agentModalFor] : selectedModel}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title={agentModalFor ? `Select model for ${agentModalFor}` : "Select Default Model for Open Claw"}
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="Open Claw - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

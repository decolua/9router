"use client";

import React, { useState, useEffect } from "react";
import { BaseToolCard } from "./";
import { 
  Button, 
  Input, 
  ManualConfigModal, 
  ModelSelectModal,
  Tooltip
} from "@/shared/components";
import { 
  ArrowRight, 
  ArrowsClockwise as RotateCcw, 
  ShieldCheck, 
  WarningCircle as AlertCircle, 
  Info,
  X,
  MagnifyingGlass as Search
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface CodexStatus {
  installed: boolean;
  has8Router: boolean;
  configPath?: string;
  config?: any;
}

interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
}

interface CodexToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: Connection[];
  baseUrl: string;
  apiKeys: any[];
  cloudEnabled: boolean;
  initialStatus?: CodexStatus | null;
}

export default function CodexToolCard({
 tool,
 isExpanded,
 onToggle,
 activeProviders,
 baseUrl,
 apiKeys,
 cloudEnabled,
 initialStatus,
}: CodexToolCardProps) {
 const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(initialStatus || null);
 const [checkingCodex, setCheckingCodex] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [selectedModel, setSelectedModel] = useState("");
 const [modalOpen, setModalOpen] = useState(false);
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);
 const [modelAliases, setModelAliases] = useState({});

 const checkStatus = async () => {
 setCheckingCodex(true);
 try {
 const res = await fetch("/api/cli-tools/codex-settings");
 const data = await res.json();
 setCodexStatus(data);
 } catch (err) {
 console.error("Error checking Codex status:", err);
 } finally {
 setCheckingCodex(false);
 }
 };

 useEffect(() => {
 if (isExpanded && !codexStatus) {
 checkStatus();
 }
 }, [isExpanded, codexStatus]);

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
 setMessage({ type: "error", text: translate("Please select a model first") });
 return;
 }
 setApplying(true);
 setMessage(null);
 try {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "" : "sk_8router"));
 const res = await fetch("/api/cli-tools/codex-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ baseUrl, apiKey: keyToUse, model: selectedModel }),
 });

 if (res.ok) {
 setMessage({ type: "success", text: translate("Codex settings applied!") });
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
 if (!confirm(translate("Remove 8Router from Codex config?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/codex-settings", { method: "DELETE" });
 if (res.ok) {
 setMessage({ type: "success", text: translate("8Router settings removed from Codex.") });
 await checkStatus();
 }
 } catch (err: any) {
 setMessage({ type: "error", text: err.message });
 } finally {
 setRestoring(false);
 }
 };

 const handleModelSelect = (model: any) => {
 setSelectedModel(model.value);
 setModalOpen(false);
 };

 const getManualConfigs = () => {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "YOUR_API_KEY" : "sk_8router"));
 const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
 return [
 { 
 filename: "config.toml", 
 content: `model = "${selectedModel || "provider/model-id"}"\nmodel_provider = "8router"\n\n[model_providers.8router]\nname = "8Router"\nbase_url = "${normalizedBaseUrl}"\nwire_api = "responses"` 
 },
 { 
 filename: "auth.json", 
 content: JSON.stringify({ OPENAI_API_KEY: keyToUse }, null, 2) 
 }
 ];
 };

 const hasActiveProviders = activeProviders.length > 0;

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={codexStatus?.installed ? (codexStatus.has8Router ? "configured" : "not_configured") : "not_configured"}
 checking={checkingCodex}
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
 {!codexStatus?.installed && (
 <div className="bg-muted/10 border border-border/50 rounded-xl p-4 flex items-start gap-3">
 <Info className="size-5 text-muted-foreground shrink-0 mt-0.5" weight="bold" />
 <p className="text-[11px] text-muted-foreground font-medium leading-relaxed italic">
 {translate("Codex CLI not detected. Settings will be written to ~/.codex/config.toml manually.")}
 </p>
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Infrastructure Node</label>
 <Input 
 value={baseUrl} 
 readOnly 
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 font-mono opacity-60 cursor-not-allowed"
 />
 </div>

 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5 px-1">
 <ShieldCheck className="size-3" weight="bold" />
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
 onClick={() => setModalOpen(true)} 
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
 </div>
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={handleModelSelect}
 selectedModel={selectedModel}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title="Select Model for Codex"
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="Codex CLI - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

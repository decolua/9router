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
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface DroidStatus {
  installed: boolean;
  has8Router: boolean;
  configPath?: string;
  config?: any;
}

interface DroidToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: any[];
  baseUrl: string;
  apiKeys: any[];
  cloudEnabled: boolean;
  initialStatus?: DroidStatus | null;
  hasActiveProviders: boolean;
}

export default function DroidToolCard({
 tool,
 isExpanded,
 onToggle,
 activeProviders,
 baseUrl,
 apiKeys,
 cloudEnabled,
 initialStatus,
 hasActiveProviders,
}: DroidToolCardProps) {
 const [droidStatus, setDroidStatus] = useState<DroidStatus | null>(initialStatus || null);
 const [checkingDroid, setCheckingDroid] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [selectedModel, setSelectedModel] = useState("");
 const [modalOpen, setModalOpen] = useState(false);
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);
 const [modelAliases, setModelAliases] = useState({});
 const hasInitialized = useRef(false);

 const checkStatus = async () => {
 setCheckingDroid(true);
 try {
 const res = await fetch("/api/cli-tools/droid-settings");
 const data = await res.json();
 setDroidStatus(data);
 if (!hasInitialized.current && data.config) {
 setSelectedModel(data.config.openai_model_id || "");
 hasInitialized.current = true;
 }
 } catch (err) {
 console.error("Error checking Droid status:", err);
 } finally {
 setCheckingDroid(false);
 }
 };

 useEffect(() => {
 if (isExpanded && !droidStatus) {
 checkStatus();
 }
 }, [isExpanded, droidStatus]);

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
 const res = await fetch("/api/cli-tools/droid-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ baseUrl, apiKey: keyToUse, model: selectedModel }),
 });

 if (res.ok) {
 setMessage({ type: "success", text: translate("Droid settings applied!") });
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
 if (!confirm(translate("Remove 8Router from Droid config?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
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
 setSelectedModel(model.value);
 setModalOpen(false);
 };

 const getManualConfigs = () => {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "YOUR_API_KEY" : "sk_8router"));
 const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
 const config = {
  openai_base_url: normalizedBaseUrl,
  openai_api_key: keyToUse,
  openai_model_id: selectedModel || "provider/model-id"
 };

 return [{ filename: "config.json", content: JSON.stringify(config, null, 2) }];
 };

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={droidStatus?.installed ? (droidStatus.has8Router ? "configured" : "not_configured") : "not_configured"}
 checking={checkingDroid}
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
 {!droidStatus?.installed && (
 <div className="bg-muted/10 border border-border/50 rounded-xl p-4 flex items-start gap-3">
 <Info className="size-5 text-muted-foreground shrink-0 mt-0.5" weight="bold" />
 <p className="text-[11px] text-muted-foreground font-medium leading-relaxed italic">
 {translate("Droid CLI not detected. Settings will be written to ~/.droid/config.json manually.")}
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
 title="Select Model for Droid"
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="Droid CLI - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

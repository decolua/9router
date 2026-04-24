"use client";

import React, { useState, useEffect, useRef } from "react";
import { BaseToolCard } from "./";
import { 
  Button, 
  Input, 
  ManualConfigModal, 
  ModelSelectModal,
  Badge
} from "@/shared/components";
import { 
  ArrowsClockwise as RotateCcw, 
  ShieldCheck, 
  Info,
  X,
  Plus
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface OpenCodeStatus {
  installed: boolean;
  has8Router: boolean;
  opencode?: {
    models: string[];
    activeModel: string | null;
    baseURL: string | null;
  };
}

interface OpenCodeToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: any[];
  baseUrl: string;
  apiKeys: any[];
  cloudEnabled: boolean;
  initialStatus?: OpenCodeStatus | null;
}

export default function OpenCodeToolCard({
 tool,
 isExpanded,
 onToggle,
 activeProviders,
 baseUrl,
 apiKeys,
 cloudEnabled,
 initialStatus,
}: OpenCodeToolCardProps) {
 const [opencodeStatus, setOpencodeStatus] = useState<OpenCodeStatus | null>(initialStatus || null);
 const [checkingOpencode, setCheckingOpencode] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [models, setModels] = useState<string[]>([]);
 const [activeModel, setActiveModel] = useState("");
 const [subagentModel, setSubagentModel] = useState("");
 const [modalOpen, setModalOpen] = useState(false);
 const [modalFor, setModalFor] = useState<"models" | "active" | "subagent" | null>(null);
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);
 const [modelAliases, setModelAliases] = useState({});
 const hasInitialized = useRef(false);

 const checkStatus = async () => {
 setCheckingOpencode(true);
 try {
 const res = await fetch("/api/cli-tools/opencode-settings");
 const data = await res.json();
 setOpencodeStatus(data);
 if (!hasInitialized.current && data.opencode) {
 setModels(data.opencode.models || []);
 setActiveModel(data.opencode.activeModel || "");
 setSubagentModel("");
 hasInitialized.current = true;
 }
 } catch (err) {
 console.error("Error checking OpenCode status:", err);
 } finally {
 setCheckingOpencode(false);
 }
 };

 useEffect(() => {
 if (isExpanded && !opencodeStatus) {
 checkStatus();
 }
 }, [isExpanded, opencodeStatus]);

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 fetch("/api/models/alias").then(r => r.json()).then(d => setModelAliases(d.aliases || {}));
 }, []);

 const handleApply = async () => {
 if (models.length === 0) {
 setMessage({ type: "error", text: translate("Please add at least one model") });
 return;
 }
 setApplying(true);
 setMessage(null);
 try {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "" : "sk_8router"));
 const res = await fetch("/api/cli-tools/opencode-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ 
   baseUrl, 
   apiKey: keyToUse, 
   models,
   activeModel: activeModel || models[0],
   subagentModel: subagentModel || models[0]
 }),
 });

 if (res.ok) {
 setMessage({ type: "success", text: translate("OpenCode settings applied!") });
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
 if (!confirm(translate("Remove 8Router from OpenCode config?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/opencode-settings", { method: "DELETE" });
 if (res.ok) {
 setMessage({ type: "success", text: translate("8Router settings removed.") });
 setModels([]);
 setActiveModel("");
 setSubagentModel("");
 await checkStatus();
 }
 } catch (err: any) {
 setMessage({ type: "error", text: err.message });
 } finally {
 setRestoring(false);
 }
 };

 const handleModelSelect = (model: any) => {
 if (modalFor === "models") {
 if (!models.includes(model.value)) setModels([...models, model.value]);
 } else if (modalFor === "active") {
 setActiveModel(model.value);
 if (!models.includes(model.value)) setModels([...models, model.value]);
 } else if (modalFor === "subagent") {
 setSubagentModel(model.value);
 if (!models.includes(model.value)) setModels([...models, model.value]);
 }
 setModalOpen(false);
 };

 const removeModel = (m: string) => {
 setModels(models.filter(item => item !== m));
 if (activeModel === m) setActiveModel("");
 if (subagentModel === m) setSubagentModel("");
 };

 const getManualConfigs = () => {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "YOUR_API_KEY" : "sk_8router"));
 const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
 const modelList = models.length > 0 ? models : ["provider/model-id"];
 const active = activeModel || modelList[0];
 
 const providerObj: any = {
 npm: "@ai-sdk/openai-compatible",
 options: { baseURL: normalizedBaseUrl, apiKey: keyToUse },
 models: {}
 };
 modelList.forEach(m => { providerObj.models[m] = { name: m }; });

 const config = {
 model: `8router/${active}`,
 provider: { "8router": providerObj },
 agent: {
 explorer: {
 mode: "subagent",
 model: `8router/${subagentModel || active}`,
 description: "Explorer subagent"
 }
 }
 };

 return [{ filename: "opencode.json", content: JSON.stringify(config, null, 2) }];
 };

 const hasActiveProviders = activeProviders.length > 0;

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={opencodeStatus?.installed ? (opencodeStatus.has8Router ? "configured" : "not_configured") : "not_configured"}
 checking={checkingOpencode}
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
 {!opencodeStatus?.installed && (
 <div className="bg-muted/10 border border-border/50 rounded-xl p-4 flex items-start gap-3">
 <Info className="size-5 text-muted-foreground shrink-0 mt-0.5" weight="bold" />
 <p className="text-[11px] text-muted-foreground font-medium leading-relaxed italic">
 {translate("OpenCode CLI not detected. Settings will be written to ~/.config/opencode/opencode.json manually.")}
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

 {/* Models List */}
 <div className="col-span-full space-y-4 pt-2">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Intelligence Catalog</span>
 <Button 
 variant="outline" 
 size="xs" 
 onClick={() => { setModalFor("models"); setModalOpen(true); }}
 disabled={!hasActiveProviders}
 className="h-6 rounded-none text-[9px] font-bold uppercase tracking-widest border-border/50 hover:bg-muted/10"
 >
 <Plus className="size-2.5 mr-1" weight="bold" /> {translate("Add Model")}
 </Button>
 </div>
 
 <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-muted/5 border border-border/40 rounded-none">
 {models.length === 0 ? (
 <p className="text-[10px] text-muted-foreground italic opacity-40 uppercase tracking-widest flex items-center h-full w-full justify-center">Catalog is empty</p>
 ) : (
 models.map(m => (
 <Badge key={m} variant="secondary" className="h-6 gap-1 pr-1 pl-2 font-mono text-[10px] bg-primary/10 text-primary border-none rounded-none group">
 {m}
 <button onClick={() => removeModel(m)} className="p-0.5 hover:bg-primary/20 rounded-full transition-colors opacity-0 group-hover:opacity-100">
 <X className="size-3" weight="bold" />
 </button>
 </Badge>
 ))
 )}
 </div>
 </div>

 {/* Model Roles */}
 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Active Model</label>
 <div className="flex gap-2">
 <Input value={activeModel} readOnly placeholder="Select from catalog..." className="h-9 text-xs rounded-none border-border/50 bg-muted/5" />
 <Button variant="outline" size="sm" onClick={() => { setModalFor("active"); setModalOpen(true); }} disabled={!hasActiveProviders} className="h-9 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50">
 {translate("Set")}
 </Button>
 </div>
 </div>

 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Explorer Agent</label>
 <div className="flex gap-2">
 <Input value={subagentModel} readOnly placeholder="Select from catalog..." className="h-9 text-xs rounded-none border-border/50 bg-muted/5" />
 <Button variant="outline" size="sm" onClick={() => { setModalFor("subagent"); setModalOpen(true); }} disabled={!hasActiveProviders} className="h-9 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50">
 {translate("Set")}
 </Button>
 </div>
 </div>
 </div>
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={handleModelSelect}
 selectedModel={modalFor === "active" ? activeModel : modalFor === "subagent" ? subagentModel : null}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title={translate("Select Intelligence Node")}
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="OpenCode CLI - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

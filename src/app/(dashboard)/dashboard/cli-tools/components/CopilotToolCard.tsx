"use client";

import React, { useState, useEffect } from "react";
import { 
 Button, 
 Input, 
 ModelSelectModal, 
 ManualConfigModal,
 Badge
} from "@/shared/components";
import { BaseToolCard } from "./";
import { 
 ArrowsClockwise as RotateCcw, 
 X, 
 Plus, 
 Info, 
 MagnifyingGlass as Search 
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface CopilotStatus {
  installed: boolean;
  has8Router: boolean;
  currentUrl?: string;
  config?: any[];
  error?: string;
}

interface CopilotToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: any[];
  activeProviders: any[];
  cloudEnabled: boolean;
  initialStatus?: CopilotStatus | null;
}

export default function CopilotToolCard({ 
 tool, 
 isExpanded, 
 onToggle, 
 baseUrl, 
 apiKeys, 
 activeProviders, 
 cloudEnabled, 
 initialStatus 
}: CopilotToolCardProps) {
 const [status, setStatus] = useState<CopilotStatus | null>(initialStatus || null);
 const [checking, setChecking] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [modelAliases, setModelAliases] = useState({});
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);

 const [modelInput, setModelInput] = useState("");
 const [modelList, setModelList] = useState<string[]>([]);
 const [modalOpen, setModalOpen] = useState(false);

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 if (initialStatus) setStatus(initialStatus);
 }, [initialStatus]);

 useEffect(() => {
 if (status?.config && Array.isArray(status.config) && modelList.length === 0) {
 const entry = status.config.find((e: any) => e.name === "8Router");
 if (entry?.models?.length > 0) {
 setModelList(entry.models.map((m: any) => m.id));
 }
 }
 }, [status, modelList.length]);

 const fetchModelAliases = async () => {
 try {
 const res = await fetch("/api/models/alias");
 const data = await res.json();
 if (res.ok) setModelAliases(data.aliases || {});
 } catch (error) {
 console.log("Error fetching model aliases:", error);
 }
 };

 const checkStatus = async () => {
 setChecking(true);
 try {
 const res = await fetch("/api/cli-tools/copilot-settings");
 const data = await res.json();
 setStatus(data);
 } catch (error: any) {
 setStatus({ installed: false, has8Router: false, error: error.message });
 } finally {
 setChecking(false);
 }
 };

 useEffect(() => {
 if (isExpanded) {
 if (!status) checkStatus();
 fetchModelAliases();
 }
 }, [isExpanded]);

 const getConfigStatus = () => {
 if (!status) return "not_configured";
 if (!status.has8Router) return "not_configured";
 const url = status.currentUrl || "";
 return url.includes("localhost") || url.includes("127.0.0.1") || url.includes(baseUrl)
 ? "configured" : "other";
 };

 const configStatus = getConfigStatus();
 const getEffectiveBaseUrl = () => baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

 const addModel = () => {
 const val = modelInput.trim();
 if (!val || modelList.includes(val)) return;
 setModelList((prev) => [...prev, val]);
 setModelInput("");
 };

 const removeModel = (id: string) => setModelList((prev) => prev.filter((m) => m !== id));

 const handleApply = async () => {
 setApplying(true);
 setMessage(null);
 try {
 const keyToUse = (selectedApiKey && selectedApiKey.trim())
 ? selectedApiKey
 : (!cloudEnabled ? "sk_8router" : selectedApiKey);

 const res = await fetch("/api/cli-tools/copilot-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: modelList }),
 });
 const data = await res.json();
 if (res.ok) {
 setMessage({ type: "success", text: translate("Configuration applied successfully!") });
 checkStatus();
 } else {
 setMessage({ type: "error", text: data.error || translate("Failed to apply configuration") });
 }
 } catch (error: any) {
 setMessage({ type: "error", text: error.message });
 } finally {
 setApplying(false);
 }
 };

 const handleReset = async () => {
 if (!confirm(translate("Reset Copilot settings?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/copilot-settings", { method: "DELETE" });
 const data = await res.json();
 if (res.ok) {
 setMessage({ type: "success", text: translate("Configuration reset!") });
 setModelList([]);
 checkStatus();
 } else {
 setMessage({ type: "error", text: data.error || translate("Failed to reset configuration") });
 }
 } catch (error: any) {
 setMessage({ type: "error", text: error.message });
 } finally {
 setRestoring(false);
 }
 };

 const getManualConfigs = () => {
 const keyToUse = (selectedApiKey && selectedApiKey.trim())
 ? selectedApiKey
 : (!cloudEnabled ? "sk_8router" : "<API_KEY_FROM_DASHBOARD>");
 const effectiveBaseUrl = getEffectiveBaseUrl();

 return [{
 filename: "~/Library/Application Support/Code/User/chatLanguageModels.json",
 content: JSON.stringify([{
 name: "8Router",
 vendor: "azure",
 apiKey: keyToUse,
 models: modelList.map((id) => ({
 id, name: id,
 url: `${effectiveBaseUrl}/chat/completions#models.ai.azure.com`,
 toolCalling: true, vision: false,
 maxInputTokens: 128000, maxOutputTokens: 16000,
 })),
 }], null, 2),
 }];
 };

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={configStatus}
 checking={checking}
 applying={applying}
 restoring={restoring}
 message={message}
 onApply={handleApply}
 onReset={handleReset}
 onShowManualConfig={() => setShowManualConfigModal(true)}
 onCheckStatus={checkStatus}
 hasActiveProviders={activeProviders?.length > 0 && modelList.length > 0}
 >
 <div className="space-y-6">
 <div className="flex items-start gap-3 p-4 bg-primary/10 border border-primary/20 rounded-xl">
 <Info className="text-primary size-5 shrink-0 mt-0.5" weight="bold" />
 <div className="space-y-1">
 <p className="text-xs font-bold text-primary uppercase tracking-widest">
 {translate("Registry modification")}: <code className="px-1.5 py-0.5 bg-primary/10 rounded-none font-mono text-[10px]">chatLanguageModels.json</code>
 </p>
 <p className="text-[11px] text-primary/80 font-medium leading-relaxed italic">
 {translate("Please restart VS Code after applying changes for the models to appear.")}
 </p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
 {/* API Key */}
 <div className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 Access Key
 </label>
 {apiKeys?.length > 0 ? (
 <select 
 value={selectedApiKey} 
 onChange={(e) => setSelectedApiKey(e.target.value)} 
 className="w-full h-9 px-3 bg-muted/5 border border-border/50 rounded-none text-xs font-bold focus:outline-none focus:border-primary/50 transition-all"
 >
 {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
 </select>
 ) : (
 <div className="h-9 flex items-center px-3 bg-muted/10 border border-border/50 border-dashed rounded-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
 {cloudEnabled ? translate("No keys found") : "sk_8router (Internal)"}
 </div>
 )}
 </div>

 {/* Models */}
 <div className="col-span-full space-y-4 pt-2 border-t border-border/40 mt-2">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">{translate("Intelligence Inventory")} ({modelList.length})</span>
 </div>
 
 <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-muted/5 border border-border/40 rounded-none">
 {modelList.length === 0 ? (
 <p className="text-[10px] text-muted-foreground italic opacity-40 uppercase tracking-widest flex items-center h-full w-full justify-center">Inventory is empty</p>
 ) : (
 modelList.map((id) => (
 <Badge key={id} variant="secondary" className="h-6 gap-1 pr-1 pl-2 font-mono text-[10px] bg-primary/10 text-primary border-none rounded-none group">
 {id}
 <button onClick={() => removeModel(id)} className="p-0.5 hover:bg-primary/20 rounded-full transition-colors opacity-0 group-hover:opacity-100">
 <X className="size-3" weight="bold" />
 </button>
 </Badge>
 ))
 )}
 </div>
 
 <div className="flex items-center gap-2 pt-2">
 <Input 
 value={modelInput} 
 onChange={(e) => setModelInput(e.target.value)} 
 onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
 placeholder="provider/model-id"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 flex-1 font-mono focus-visible:ring-0 focus-visible:border-primary/50"
 />
 <Button 
 variant="outline"
 size="sm"
 onClick={() => setModalOpen(true)} 
 disabled={!activeProviders?.length}
 className="h-9 px-4 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background hover:bg-muted/10 transition-colors"
 >
 {translate("Select")}
 </Button>
 <Button 
 variant="outline"
 size="icon"
 onClick={addModel} 
 disabled={!modelInput.trim()} 
 className="h-9 w-9 rounded-none border-border/50 bg-muted/5"
 >
 <Plus className="size-4" weight="bold" />
 </Button>
 </div>
 </div>
 </div>
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={(model) => { 
 setModelInput(model.value); 
 setModalOpen(false); 
 }}
 selectedModel={modelInput}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title={translate("Select Intelligence Node")}
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="GitHub Copilot - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
 Button, 
 ModelSelectModal, 
 ManualConfigModal, 
 Input,
 Toggle
} from "@/shared/components";
import { BaseToolCard } from "./";
import { ArrowRight, ArrowsClockwise as RotateCcw, X, Info, MagnifyingGlass as Search, ShieldWarning as ShieldAlert, BookOpen } from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface ClaudeStatus {
  installed: boolean;
  settings?: {
    env?: {
      ANTHROPIC_BASE_URL?: string;
      [key: string]: any;
    };
  };
}

interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
}

interface ClaudeToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: Connection[];
  modelMappings: Record<string, string>;
  onModelMappingChange: (alias: string, target: string) => void;
  baseUrl: string;
  hasActiveProviders: boolean;
  apiKeys: any[];
  cloudEnabled: boolean;
  initialStatus?: ClaudeStatus | null;
}

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function ClaudeToolCard({
 tool,
 isExpanded,
 onToggle,
 activeProviders,
 modelMappings,
 onModelMappingChange,
 baseUrl,
 hasActiveProviders,
 apiKeys,
 cloudEnabled,
 initialStatus,
}: ClaudeToolCardProps) {
 const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(initialStatus || null);
 const [checkingClaude, setCheckingClaude] = useState(false);
 const [applying, setApplying] = useState(false);
 const [restoring, setRestoring] = useState(false);
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [showInstallGuide, setShowInstallGuide] = useState(false);
 const [modalOpen, setModalOpen] = useState(false);
 const [currentEditingAlias, setCurrentEditingAlias] = useState<string | null>(null);
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [modelAliases, setModelAliases] = useState({});
 const [showManualConfigModal, setShowManualConfigModal] = useState(false);
 const [customBaseUrl, setCustomBaseUrl] = useState("");
 const [ccFilterNaming, setCcFilterNaming] = useState(false);
 const hasInitializedModels = useRef(false);

 const getConfigStatus = () => {
 if (!claudeStatus?.installed) return "not_configured";
 const currentUrl = claudeStatus.settings?.env?.ANTHROPIC_BASE_URL || "";
 const expectedUrl = getDisplayUrl();
 if (currentUrl.includes(expectedUrl) || expectedUrl.includes(currentUrl)) return "configured";
 return "other";
 };

 const checkStatus = async () => {
 setCheckingClaude(true);
 try {
 const res = await fetch("/api/cli-tools/claude-settings");
 const data = await res.json();
 setClaudeStatus(data);
 } catch (err) {
 console.error("Error checking Claude status:", err);
 } finally {
 setCheckingClaude(false);
 }
 };

 useEffect(() => {
 if (isExpanded && !claudeStatus) {
 checkStatus();
 }
 }, [isExpanded, claudeStatus]);

 useEffect(() => {
 if (claudeStatus && isExpanded) {
 tool.defaultModels.forEach((m: any) => {
 const existingVal = claudeStatus?.settings?.env?.[m.envKey];
 if (existingVal && modelMappings[m.alias] !== existingVal) {
 onModelMappingChange(m.alias, existingVal);
 } else if (!existingVal && m.id && !modelMappings[m.alias]) {
 onModelMappingChange(m.alias, m.id);
 }
 });
 }
 }, [isExpanded, claudeStatus, tool.defaultModels]);

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 fetch("/api/models/alias").then(r => r.json()).then(d => setModelAliases(d.aliases || {}));
 fetch("/api/settings").then(r => r.json()).then(d => setCcFilterNaming(!!d.ccFilterNaming));
 }, []);

 const handleApply = async () => {
 setApplying(true);
 setMessage(null);
 try {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "" : "sk_8router"));
 const env: any = {
 ANTHROPIC_BASE_URL: getDisplayUrl(),
 ANTHROPIC_AUTH_TOKEN: keyToUse,
 };
 
 tool.defaultModels.forEach((m: any) => {
 const target = modelMappings[m.alias];
 if (target) env[m.envKey] = target;
 });

 const res = await fetch("/api/cli-tools/claude-settings", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ env }),
 });

 if (res.ok) {
 setMessage({ type: "success", text: translate("Settings applied! Restart Claude Code to take effect.") });
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
 if (!confirm(translate("Reset Claude Code settings to default?"))) return;
 setRestoring(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
 if (res.ok) {
 setMessage({ type: "success", text: translate("Settings reset to defaults.") });
 await checkStatus();
 }
 } catch (err: any) {
 setMessage({ type: "error", text: err.message });
 } finally {
 setRestoring(false);
 }
 };

 const handleModelSelect = (model: any) => {
 if (currentEditingAlias) {
 onModelMappingChange(currentEditingAlias, model.value);
 }
 setModalOpen(false);
 };

 const getLocalBaseUrl = () => baseUrl || "http://localhost:20128";
 const getDisplayUrl = () => customBaseUrl || getLocalBaseUrl();

 const getManualConfigs = () => {
 const keyToUse = selectedApiKey?.trim() || (apiKeys?.length > 0 ? apiKeys[0].key : (cloudEnabled ? "YOUR_API_KEY" : "sk_8router"));
 const envLines = [
 `export ANTHROPIC_BASE_URL="${getDisplayUrl()}"`, `export ANTHROPIC_AUTH_TOKEN="${keyToUse}"`,
 ];
 
 tool.defaultModels.forEach((m: any) => {
 const target = modelMappings[m.alias];
 if (target) envLines.push(`export ${m.envKey}="${target}"`);
 });

 return [{ filename: ".zshrc / .bashrc", content: envLines.join("\n") }];
 };

 const handleToggleFilterNaming = async (val: boolean) => {
 setCcFilterNaming(val);
 try {
 await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ccFilterNaming: val }),
 });
 } catch (e) { console.error(e); }
 };

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={getConfigStatus()}
 checking={checkingClaude}
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
 {/* Installation Notice */}
 {!claudeStatus?.installed && (
 <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
 <ShieldAlert className="size-5 text-amber-500 shrink-0 mt-0.5" weight="bold" />
 <div className="space-y-1">
 <p className="text-xs font-bold text-amber-600 dark:text-amber-500 uppercase tracking-widest">{translate("Claude Code not detected")}</p>
 <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 font-medium leading-relaxed italic">
 {translate("Settings will be written to ~/.claude/settings.json manually.")}
 </p>
 <Button 
 variant="link" 
 size="xs" 
 onClick={() => setShowInstallGuide(!showInstallGuide)}
 className="p-0 h-auto text-amber-600 dark:text-amber-500 font-bold uppercase tracking-widest text-[10px] mt-1"
 >
 {showInstallGuide ? translate("Hide Guide") : translate("View Install Guide")}
 </Button>
 </div>
 </div>
 )}

 {showInstallGuide && (
 <div className="space-y-3 bg-muted/20 p-4 rounded-xl border border-border/40">
 <p className="text-xs font-bold text-foreground flex items-center gap-2">
 <BookOpen className="size-4" weight="bold" />
 {translate("How to install Claude Code:")}
 </p>
 <code className="block p-3 bg-background rounded-lg border border-border/50 text-[11px] font-mono text-primary">
 npm install -g @anthropic-ai/claude-code
 </code>
 <p className="text-[10px] text-muted-foreground font-medium italic">{translate("After installing, run `claude` once to initialize settings.")}</p>
 </div>
 ) }

 {/* Form Content */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
 {/* Base URL */}
 <div className="space-y-2">
 <div className="flex items-center justify-between px-1">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Endpoint URL</label>
 {getConfigStatus() === "other" && (
 <span className="text-[9px] text-muted-foreground/60 italic tabular-nums">Current: {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL}</span>
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

 {/* Filter Logic Toggle */}
 <div className="space-y-2">
 <div className="flex items-center justify-between p-3 bg-muted/5 border border-border/50 rounded-none h-9">
 <div className="flex items-center gap-2">
 <Search className="size-3.5 text-muted-foreground" weight="bold" />
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{translate("Intelligent Mapping")}</span>
 </div>
 <Toggle checked={ccFilterNaming} onCheckedChange={handleToggleFilterNaming} className="scale-75 data-[state=checked]:bg-primary" />
 </div>
 <p className="text-[9px] text-muted-foreground/60 font-medium italic leading-tight px-1">
 {translate("Remove `(alias)` from model IDs sent to Claude Code for better compatibility.")}
 </p>
 </div>

 {/* Model Mappings */}
 <div className="col-span-full space-y-4 pt-4 border-t border-border/40">
 <div className="flex items-center gap-2 px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Infrastructure Routing</span>
 <div className="h-px flex-1 bg-border/40"></div>
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {tool.defaultModels.map((model: any) => (
 <div key={model.alias} className="space-y-2">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">{model.name}</label>
 <div className="flex items-center gap-2">
 <Input 
 value={modelMappings[model.alias] || ""} 
 onChange={(e) => onModelMappingChange(model.alias, e.target.value)} 
 placeholder="provider/model-id"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50 transition-colors flex-1"
 />
 <Button 
 variant="outline" 
 size="sm" 
 onClick={() => { setCurrentEditingAlias(model.alias); setModalOpen(true); }} 
 disabled={!hasActiveProviders}
 className="h-9 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors"
 >
 {translate("Map")}
 </Button>
 {modelMappings[model.alias] && (
 <Button variant="ghost" size="icon" onClick={() => onModelMappingChange(model.alias, "")} className="size-9 rounded-none text-muted-foreground hover:text-destructive transition-colors border border-border/50 bg-muted/5">
 <X className="size-4" weight="bold" />
 </Button>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={handleModelSelect}
 selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title={translate("Select model for") + ` ${currentEditingAlias}`}
 />

 <ManualConfigModal
 isOpen={showManualConfigModal}
 onClose={() => setShowManualConfigModal(false)}
 title="Claude Code - Manual Configuration"
 configs={getManualConfigs()}
 />
 </>
 );
}

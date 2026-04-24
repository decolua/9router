"use client";

import React, { useState, useEffect } from "react";
import { 
 Button, 
 Input, 
 ModelSelectModal,
} from "@/shared/components";
import { BaseToolCard } from "./";
import { 
 ArrowRight, 
 StopCircle, 
 PlayCircle, 
 X, 
 Loader2,
 ShieldAlert,
 Info,
 CheckCircle as CheckCircle2,
 Circle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface AntigravityStatus {
  running: boolean;
  certExists: boolean;
  dnsConfigured?: boolean;
  hasCachedPassword?: boolean;
}

interface AntigravityToolCardProps {
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: any[];
  activeProviders: any[];
  hasActiveProviders: boolean;
  cloudEnabled: boolean;
  initialStatus?: AntigravityStatus | null;
}

export default function AntigravityToolCard({
 tool,
 isExpanded,
 onToggle,
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 baseUrl,
 apiKeys,
 activeProviders,
 hasActiveProviders,
 cloudEnabled,
 initialStatus,
}: AntigravityToolCardProps) {
 const [status, setStatus] = useState<AntigravityStatus | null>(initialStatus || null);
 const [loading, setLoading] = useState(false);
 const [startingStep, setStartingStep] = useState<string | null>(null); // "cert" | "server" | "dns" | null
 const [showPasswordModal, setShowPasswordModal] = useState(false);
 const [sudoPassword, setSudoPassword] = useState("");
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [modelMappings, setModelMappings] = useState<Record<string, string>>({});
 const [modalOpen, setModalOpen] = useState(false);
 const [currentEditingAlias, setCurrentEditingAlias] = useState<string | null>(null);
 const [modelAliases, setModelAliases] = useState({});

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 if (initialStatus) setStatus(initialStatus);
 }, [initialStatus]);

 const loadSavedMappings = async () => {
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm/alias?tool=antigravity");
 if (res.ok) {
 const data = await res.json();
 const aliases = data.aliases || {};
 if (Object.keys(aliases).length > 0) {
 setModelMappings(aliases);
 }
 }
 } catch (error) {
 console.log("Error loading saved mappings:", error);
 }
 };

 const fetchModelAliases = async () => {
 try {
 const res = await fetch("/api/models/alias");
 const data = await res.json();
 if (res.ok) setModelAliases(data.aliases || {});
 } catch (error) {
 console.log("Error fetching model aliases:", error);
 }
 };

 const fetchStatus = async () => {
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm");
 if (res.ok) {
 const data = await res.json();
 setStatus(data);
 }
 } catch (error) {
 console.log("Error fetching status:", error);
 setStatus({ running: false, certExists: false });
 }
 };

 useEffect(() => {
 if (isExpanded) {
 if (!status) fetchStatus();
 loadSavedMappings();
 fetchModelAliases();
 }
 }, [isExpanded]);

 const isWindows = typeof navigator !== "undefined" && navigator.userAgent?.includes("Windows");

 const handleStart = () => {
 if (isWindows || status?.hasCachedPassword) {
 doStart("");
 } else {
 setShowPasswordModal(true);
 setMessage(null);
 }
 };

 const handleStop = () => {
 if (isWindows || status?.hasCachedPassword) {
 doStop("");
 } else {
 setShowPasswordModal(true);
 setMessage(null);
 }
 };

 const doStart = async (password: string) => {
 setLoading(true);
 setMessage(null);
 setStartingStep("cert");
 try {
 const keyToUse = selectedApiKey?.trim()
 || (apiKeys?.length > 0 ? apiKeys[0].key : null)
 || (!cloudEnabled ? "sk_8router" : null);

 const res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ apiKey: keyToUse, sudoPassword: password }),
 });

 const data = await res.json();
 if (res.ok) {
 setStartingStep(null);
 setMessage({ type: "success", text: translate("MITM server started successfully!") });
 setShowPasswordModal(false);
 setSudoPassword("");
 fetchStatus();
 } else {
 setStartingStep(null);
 setMessage({ type: "error", text: data.error || translate("Failed to start") });
 }
 } catch (error: any) {
 setStartingStep(null);
 setMessage({ type: "error", text: error.message });
 } finally {
 setLoading(false);
 }
 };

 const doStop = async (password: string) => {
 setLoading(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "DELETE",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ sudoPassword: password }),
 });

 const data = await res.json();
 if (res.ok) {
 setMessage({ type: "success", text: translate("MITM server stopped!") });
 setShowPasswordModal(false);
 setSudoPassword("");
 fetchStatus();
 } else {
 setMessage({ type: "error", text: data.error || translate("Failed to stop") });
 }
 } catch (error: any) {
 setMessage({ type: "error", text: error.message });
 } finally {
 setLoading(false);
 }
 };

 const handleConfirmPassword = () => {
 if (!sudoPassword.trim()) {
 setMessage({ type: "error", text: translate("Sudo password is required") });
 return;
 }
 if (status?.running) {
 doStop(sudoPassword);
 } else {
 doStart(sudoPassword);
 }
 };

 const openModelSelector = (alias: string) => {
 setCurrentEditingAlias(alias);
 setModalOpen(true);
 };

 const handleModelSelect = (model: any) => {
 if (currentEditingAlias) {
 setModelMappings(prev => ({
 ...prev,
 [currentEditingAlias]: model.value,
 }));
 }
 };

 const handleModelMappingChange = (alias: string, value: string) => {
 setModelMappings(prev => ({
 ...prev,
 [alias]: value,
 }));
 };

 const handleSaveMappings = async () => {
 setLoading(true);
 setMessage(null);
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm/alias", {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ tool: "antigravity", mappings: modelMappings }),
 });

 if (!res.ok) {
 const data = await res.json();
 throw new Error(data.error || translate("Error saving mappings"));
 }

 setMessage({ type: "success", text: translate("Mappings saved successfully!") });
 } catch (error: any) {
 setMessage({ type: "error", text: error.message });
 } finally {
 setLoading(false);
 }
 };

 const isRunning = !!status?.running;

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={isRunning ? "configured" : "not_configured"}
 checking={loading && !startingStep}
 applying={loading && startingStep === null}
 restoring={false}
 message={message}
 onApply={handleSaveMappings}
 onReset={() => isRunning ? handleStop() : null}
 onCheckStatus={fetchStatus}
 hasActiveProviders={hasActiveProviders}
 >
 <div className="space-y-6">
 {/* Status Indicators */}
 <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 bg-muted/20 rounded-xl border border-border/50">
 {[
 { key: "cert", label: translate("Cert"), ok: status?.certExists },
 { key: "server", label: translate("Server"), ok: status?.running },
 { key: "dns", label: translate("DNS"), ok: status?.dnsConfigured },
 ].map(({ key, label, ok }, i) => {
 const isStepLoading = startingStep === key;
 return (
 <div key={key} className="flex items-center gap-2">
 <div className="flex items-center gap-1.5">
 {isStepLoading ? (
 <Loader2 className="size-3.5 text-primary animate-spin" />
 ) : ok ? (
 <CheckCircle2 className="size-3.5 text-primary" />
 ) : (
 <Circle className="size-3.5 text-muted-foreground" />
 )}
 <span className={cn(
 "text-xs font-medium",
 isStepLoading ? "text-primary" : ok ? "text-primary" : "text-muted-foreground"
 )}>
 {label}
 </span>
 </div>
 {i < 2 && <ArrowRight className="size-3 text-muted-foreground/30" />}
 </div>
 );
 })}
 </div>

 {/* Control Section */}
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {translate("MITM Control")}
 </label>
 {isRunning ? (
 <Button 
 variant="destructive"
 size="sm"
 onClick={handleStop} 
 disabled={loading}
 className="h-8 font-bold text-[10px] uppercase tracking-widest"
 >
 <StopCircle className="mr-1.5 size-3.5" />
 {translate("Stop MITM")}
 </Button>
 ) : (
 <Button 
 size="sm"
 onClick={handleStart} 
 disabled={loading || !hasActiveProviders}
 className="h-8 font-bold text-[10px] uppercase tracking-widest shadow-none"
 >
 <PlayCircle className="mr-1.5 size-3.5" />
 {translate("Start MITM")}
 </Button>
 )}
 </div>

 {isWindows && !isRunning && (
 <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
 <ShieldAlert className="text-amber-600 size-5 shrink-0 mt-0.5" />
 <p className="text-xs text-amber-600 font-medium leading-relaxed italic">
 <span className="font-bold uppercase tracking-widest not-italic mr-1.5">Windows:</span> {translate("Please run Terminal with Administrator privileges to enable MITM.")}
 </p>
 </div>
 )}

 {!isRunning && (
 <div className="p-4 bg-muted/10 border border-border/50 rounded-xl space-y-3">
 <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 <Info className="size-3.5" />
 {translate("Operational Flow")}
 </div>
 <ul className="space-y-2">
 <li className="text-[11px] text-muted-foreground font-medium italic flex items-start gap-2">
 <div className="size-1.5 rounded-full bg-primary/40 mt-1 shrink-0" />
 {translate("Generate and trust local SSL root certificate.")}
 </li>
 <li className="text-[11px] text-muted-foreground font-medium italic flex items-start gap-2">
 <div className="size-1.5 rounded-full bg-primary/40 mt-1 shrink-0" />
 {translate("Redirect official endpoints to localhost via system hosts.")}
 </li>
 <li className="text-[11px] text-muted-foreground font-medium italic flex items-start gap-2">
 <div className="size-1.5 rounded-full bg-primary/40 mt-1 shrink-0" />
 {translate("Route tool traffic through your provisioned 8Router nodes.")}
 </li>
 </ul>
 </div>
 )}
 </div>

 {/* Model Mappings */}
 {isRunning && (
 <div className="space-y-4 pt-4 border-t border-border/50">
 <div className="grid grid-cols-1 gap-4">
 {/* API Key */}
 <div className="space-y-1.5">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 API Key
 </label>
 {apiKeys?.length > 0 ? (
 <select 
 value={selectedApiKey} 
 onChange={(e) => setSelectedApiKey(e.target.value)} 
 className="w-full h-9 px-3 py-1 bg-muted/5 border border-border/50 rounded-none text-xs font-bold focus:outline-none focus:border-primary/50 transition-all"
 >
 {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
 </select>
 ) : (
 <div className="h-9 flex items-center px-3 bg-muted/10 border border-border/50 border-dashed rounded-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
 {cloudEnabled ? translate("No keys found") : "sk_8router (Internal)"}
 </div>
 )}
 </div>

 {/* Model Mappings */}
 {tool.defaultModels.map((model: any) => (
 <div key={model.alias} className="space-y-1.5">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1 truncate block" title={model.name}>
 {model.name}
 </label>
 <div className="flex items-center gap-2">
 <Input 
 value={modelMappings[model.alias] || ""} 
 onChange={(e) => handleModelMappingChange(model.alias, e.target.value)} 
 placeholder="provider/model-id"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 flex-1 font-mono focus-visible:ring-0 focus-visible:border-primary/50"
 />
 <Button 
 variant="outline"
 size="sm"
 onClick={() => openModelSelector(model.alias)} 
 disabled={!hasActiveProviders}
 className="h-9 px-4 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background hover:bg-muted/10 transition-colors"
 >
 {translate("Select")}
 </Button>
 {modelMappings[model.alias] && (
 <Button 
 variant="ghost"
 size="icon"
 onClick={() => handleModelMappingChange(model.alias, "")} 
 className="size-9 rounded-none text-muted-foreground hover:text-destructive border border-border/50 bg-muted/5"
 >
 <X className="size-4" />
 </Button>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </BaseToolCard>

 {/* Sudo Password Modal */}
 {showPasswordModal && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
 <div className="bg-background border border-border/50 rounded-none p-6 w-full max-w-sm flex flex-col gap-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
 <div className="space-y-1">
 <h3 className="text-lg font-bold tracking-tight text-foreground uppercase">{translate("Authority Challenge")}</h3>
 <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{translate("Sudo required for system configuration.")}</p>
 </div>

 <div className="flex items-start gap-3 p-3 bg-muted/30 border border-border/50 rounded-none">
 <ShieldAlert className="text-amber-600 size-5 shrink-0 mt-0.5" />
 <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
 {translate("Credentials used only for execution and are not persisted.")}
 </p>
 </div>

 <Input
 type="password"
 placeholder="••••••••"
 value={sudoPassword}
 onChange={(e) => setSudoPassword(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter" && !loading) handleConfirmPassword();
 }}
 className="h-10 rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50"
 autoFocus
 />

 <div className="flex items-center gap-2 pt-2">
 <Button
 variant="outline"
 size="sm"
 onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setMessage(null); }}
 disabled={loading}
 className="flex-1 h-10 font-bold text-[10px] uppercase tracking-widest rounded-none border-border/50 hover:bg-muted/30"
 >
 {translate("Cancel")}
 </Button>
 <Button
 size="sm"
 onClick={handleConfirmPassword}
 disabled={loading || !sudoPassword.trim()}
 className="flex-1 h-10 font-bold text-[10px] uppercase tracking-widest shadow-none"
 >
 {loading ? <Loader2 className="size-4 animate-spin" /> : translate("Authorize")}
 </Button>
 </div>
 </div>
 </div>
 )}

 <ModelSelectModal
 isOpen={modalOpen}
 onClose={() => setModalOpen(false)}
 onSelect={handleModelSelect}
 selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title={translate("Select Intelligence") + ` for ${currentEditingAlias}`}
 />
 </>
 );
}

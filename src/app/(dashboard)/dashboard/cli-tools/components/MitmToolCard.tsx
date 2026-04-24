"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ModelSelectModal } from "@/shared/components";
import Image from "next/image";
import { CaretDown, ArrowRight, X, StopCircle, PlayCircle, Warning as AlertTriangle, WarningCircle as AlertCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface Tool {
  id: string;
  name: string;
  image: string;
  defaultModels?: Array<{ alias: string, name: string }>;
}

interface MitmToolCardProps {
  tool: Tool;
  isExpanded: boolean;
  onToggle: () => void;
  serverRunning: boolean;
  dnsActive: boolean;
  hasCachedPassword?: boolean;
  apiKeys: any[];
  activeProviders: any[];
  hasActiveProviders: boolean;
  modelAliases?: Record<string, string>;
  cloudEnabled: boolean;
  onDnsChange?: (status: any) => void;
}

/**
 * Per-tool MITM card — shows DNS status + model mappings.
 */
export default function MitmToolCard({
 tool,
 isExpanded,
 onToggle,
 serverRunning,
 dnsActive,
 hasCachedPassword,
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 apiKeys,
 activeProviders,
 hasActiveProviders,
 modelAliases = {},
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 cloudEnabled,
 onDnsChange,
}: MitmToolCardProps) {
 const [loading, setLoading] = useState(false);
 const [warning, setWarning] = useState<string | null>(null);
 const [showPasswordModal, setShowPasswordModal] = useState(false);
 const [sudoPassword, setSudoPassword] = useState("");
 const [pendingDnsAction, setPendingDnsAction] = useState<string | null>(null);
 const [modalError, setModalError] = useState<string | null>(null);
 const [modelMappings, setModelMappings] = useState<Record<string, string>>({});
 const [modalOpen, setModalOpen] = useState(false);
 const [currentEditingAlias, setCurrentEditingAlias] = useState<string | null>(null);

 const isWindows = typeof navigator !== "undefined" && navigator.userAgent?.includes("Windows");

 const loadSavedMappings = useCallback(async () => {
 try {
 const res = await fetch(`/api/cli-tools/antigravity-mitm/alias?tool=${tool.id}`);
 if (res.ok) {
 const data = await res.json();
 if (Object.keys(data.aliases || {}).length > 0) setModelMappings(data.aliases);
 }
 } catch { /* ignore */ }
 }, [tool.id]);

 useEffect(() => {
 if (isExpanded) loadSavedMappings();
 }, [isExpanded, loadSavedMappings]);

 const saveMappings = useCallback(async (mappings: Record<string, string>) => {
 try {
 await fetch("/api/cli-tools/antigravity-mitm/alias", {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ tool: tool.id, mappings }),
 });
 } catch { /* ignore */ }
 }, [tool.id]);

 const handleMappingBlur = (alias: string, value: string) => {
 saveMappings({ ...modelMappings, [alias]: value });
 };

 const handleModelMappingChange = (alias: string, value: string) => {
 setModelMappings(prev => ({ ...prev, [alias]: value }));
 };

 const openModelSelector = (alias: string) => {
 setCurrentEditingAlias(alias);
 setModalOpen(true);
 };

 const handleModelSelect = (model: any) => {
 if (!currentEditingAlias || model.isPlaceholder) return;
 const updated = { ...modelMappings, [currentEditingAlias]: model.value };
 setModelMappings(updated);
 saveMappings(updated);
 };

 const handleDnsToggle = () => {
 if (!serverRunning) return;
 const action = dnsActive ? "disable" : "enable";
 if (isWindows || hasCachedPassword) {
 doDnsAction(action, "");
 } else {
 setPendingDnsAction(action);
 setShowPasswordModal(true);
 setModalError(null);
 }
 };

 const doDnsAction = async (action: string, password: string) => {
 setLoading(true);
 setWarning(null);
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ tool: tool.id, action, sudoPassword: password }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error || "Failed to toggle DNS");

 if (action === "enable") {
 setWarning(`Restart ${tool.name} to apply changes`);
 }

 setShowPasswordModal(false);
 setSudoPassword("");
 onDnsChange?.(data);
 } catch { /* ignore */ } finally {
 setLoading(false);
 setPendingDnsAction(null);
 }
 };

 const handleConfirmPassword = () => {
 if (!sudoPassword.trim()) {
 setModalError("Sudo password is required");
 return;
 }
 if (pendingDnsAction) doDnsAction(pendingDnsAction, sudoPassword);
 };

 return (
 <>
 <Card className="overflow-hidden p-3 rounded-none shadow-none border-border/50">
 <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
 <div className="flex items-center gap-3">
 <div className="size-8 flex items-center justify-center shrink-0 border border-border/50 bg-background rounded-none p-1">
 <Image
 src={tool.image}
 alt={tool.name}
 width={24}
 height={24}
 className="size-full object-contain"
 sizes="24px"
 onError={(e: any) => { e.target.style.display = "none"; }}
 />
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <h3 className="font-bold text-sm tracking-tight leading-none uppercase">{tool.name} Interceptor</h3>
 {!serverRunning ? (
 <Badge variant="secondary" className="h-4 px-1 text-[9px] font-bold uppercase border-none opacity-40 rounded-none">Server Off</Badge>
 ) : dnsActive ? (
 <Badge className="h-4 px-1 text-[9px] font-bold uppercase bg-primary/10 text-primary border-none rounded-none">Intercepting</Badge>
 ) : (
 <Badge variant="outline" className="h-4 px-1 text-[9px] font-bold uppercase border-border/50 bg-muted/40 text-muted-foreground opacity-60 rounded-none">Idle</Badge>
 )}
 </div>
 <p className="text-[10px] text-muted-foreground font-medium mt-1 uppercase tracking-widest opacity-60">Redirect tool traffic through infrastructure node</p>
 </div>
 </div>
 <CaretDown className={cn("size-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} weight="bold" />
 </div>

 {isExpanded && (
 <div className="mt-4 pt-4 border-t border-border/40 flex flex-col gap-5">
 <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground font-medium px-1 uppercase tracking-widest opacity-60 italic">
 <p>Modify local DNS records to redirect {tool.name} requests via 8Router MITM proxy.</p>
 {!dnsActive && (
 <p className="text-destructive mt-1 font-bold">
 ⚠️ Enable DNS interception to modify model mappings
 </p>
 )}
 </div>

 {/* Model Mappings */}
 <div className="space-y-4">
 <div className="flex items-center gap-2 px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Intelligence Mapping</span>
 <div className="h-px flex-1 bg-border/40"></div>
 </div>

 {tool.defaultModels?.length ? (
 <div className="flex flex-col gap-2">
 {tool.defaultModels.map((model) => (
 <div key={model.alias} className="flex items-center gap-2">
 <span className="w-32 shrink-0 text-[10px] font-bold text-foreground text-right uppercase tracking-widest opacity-60">{model.name}</span>
 <ArrowRight className="size-3 text-muted-foreground opacity-40" weight="bold" />
 <Input
 type="text"
 value={modelMappings[model.alias] || ""}
 onChange={(e) => handleModelMappingChange(model.alias, e.target.value)}
 onBlur={(e) => handleMappingBlur(model.alias, e.target.value)}
 placeholder="provider/model-id"
 disabled={!dnsActive}
 className="h-8 flex-1 text-xs rounded-none border-border/50 bg-background font-mono focus-visible:ring-0 focus-visible:border-primary/50 transition-colors"
 />
 <Button
 variant="outline"
 size="sm"
 onClick={() => openModelSelector(model.alias)}
 disabled={!hasActiveProviders || !dnsActive}
 className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background"
 >
 Map
 </Button>
 {modelMappings[model.alias] && (
 <Button
 variant="ghost"
 size="icon"
 onClick={() => {
 handleModelMappingChange(model.alias, "");
 saveMappings({ ...modelMappings, [model.alias]: "" });
 }}
 className="size-8 rounded-none text-muted-foreground hover:text-destructive transition-colors border border-border/50 bg-background"
 title="Clear Mapping"
 >
 <X className="size-3.5" weight="bold" />
 </Button>
 )}
 </div>
 ))}
 </div>
 ) : (
 <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-30 px-1 py-4 text-center italic">Mappings will be provisioned in next cycle.</p>
 )}
 </div>

 {/* Actions */}
 <div className="flex flex-col gap-2 items-start border-t border-border/40 pt-4">
 {dnsActive ? (
 <Button
 variant="destructive"
 size="sm"
 onClick={handleDnsToggle}
 disabled={!serverRunning || loading}
 className="h-8 rounded-none border-none bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-widest hover:bg-destructive/20 transition-colors px-6"
 >
 <StopCircle className="size-4 mr-1.5" weight="bold" />
 Terminate DNS
 </Button>
 ) : (
 <Button
 size="sm"
 onClick={handleDnsToggle}
 disabled={!serverRunning || loading}
 className="h-8 rounded-none border-none bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20 transition-colors px-6 shadow-none"
 >
 <PlayCircle className="size-4 mr-1.5" weight="bold" />
 Activate DNS
 </Button>
 )}

 {warning && (
 <div className="flex items-center gap-2 px-2 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-widest text-amber-600 bg-amber-500/10 border border-amber-500/20 mt-1">
 <AlertTriangle className="size-3.5" weight="bold" />
 <span>{warning}</span>
 </div>
 )}
 </div>
 </div>
 )}
 </Card>

 {/* Password Modal */}
 {showPasswordModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
 <div className="bg-background border border-border/50 rounded-none p-6 w-full max-w-sm flex flex-col gap-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
 <div className="space-y-1">
 <h3 className="text-lg font-bold tracking-tight text-foreground uppercase">Authority challenge</h3>
 <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Sudo required for system configuration.</p>
 </div>
 <div className="flex items-start gap-3 p-3 bg-muted/30 border border-border/50 rounded-none">
 <AlertTriangle className="size-5 text-amber-500 shrink-0" weight="bold" />
 <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">Required to modify system hosts file and clear resolver cache.</p>
 </div>
 <Input
 type="password"
 placeholder="••••••••"
 value={sudoPassword}
 onChange={(e) => setSudoPassword(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleConfirmPassword(); }}
 className="h-10 text-lg rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50"
 autoFocus
 />
 {modalError && (
 <div className="flex items-center gap-2 px-3 py-2 rounded-none text-[10px] font-bold uppercase bg-destructive/5 text-destructive border border-destructive/20">
 <AlertCircle className="size-3.5" weight="bold" />
 <span>{modalError}</span>
 </div>
 )}
 <div className="flex items-center gap-2 pt-2">
 <Button variant="outline" size="sm" className="flex-1 rounded-none h-10 text-[10px] font-bold uppercase tracking-widest border-border/50" onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); }} disabled={loading}>
 Cancel
 </Button>
 <Button size="sm" className="flex-1 rounded-none h-10 text-[10px] font-bold uppercase tracking-widest shadow-none" onClick={handleConfirmPassword} disabled={loading}>
 {loading ? "Verifying..." : "Authorize"}
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Model Select Modal */}
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

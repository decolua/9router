"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Shield, 
  CheckCircle, 
  XCircle, 
  ShieldCheck, 
  StopCircle, 
  PlayCircle, 
  WarningCircle as AlertCircle, 
  Warning as AlertTriangle 
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

interface ApiKey {
  id: string;
  key: string;
}

interface MitmStatus {
  running: boolean;
  certExists: boolean;
  certTrusted?: boolean;
  isAdmin?: boolean;
  hasCachedPassword?: boolean;
  mitmRouterBaseUrl?: string;
  dnsStatus?: Record<string, boolean>;
}

interface MitmServerCardProps {
  apiKeys: ApiKey[];
  cloudEnabled: boolean;
  onStatusChange?: (status: MitmStatus) => void;
}

/**
 * Shared MITM infrastructure card — manages SSL cert + server start/stop.
 */
export default function MitmServerCard({ apiKeys, cloudEnabled, onStatusChange }: MitmServerCardProps) {
 const [status, setStatus] = useState<MitmStatus | null>(null);
 const [loading, setLoading] = useState(false);
 const [showPasswordModal, setShowPasswordModal] = useState(false);
 const [sudoPassword, setSudoPassword] = useState("");
 const [selectedApiKey, setSelectedApiKey] = useState("");
 const [pendingAction, setPendingAction] = useState<string | null>(null);
 const [modalError, setModalError] = useState<string | null>(null);
 const [actionError, setActionError] = useState<string | null>(null);
 const [mitmRouterBaseUrl, setMitmRouterBaseUrl] = useState(DEFAULT_MITM_ROUTER_BASE);

 const isWindows = typeof navigator !== "undefined" && navigator.userAgent?.includes("Windows");
 const isAdmin = status?.isAdmin !== false;

 useEffect(() => {
 if (apiKeys?.length > 0 && !selectedApiKey) {
 setSelectedApiKey(apiKeys[0].key);
 }
 }, [apiKeys, selectedApiKey]);

 useEffect(() => {
 fetchStatus();
 }, []);

 const fetchStatus = async () => {
 try {
 const res = await fetch("/api/cli-tools/antigravity-mitm");
 if (res.ok) {
 const data = await res.json();
 setStatus(data);
 if (data.mitmRouterBaseUrl) {
 setMitmRouterBaseUrl(data.mitmRouterBaseUrl);
 }
 onStatusChange?.(data);
 }
 } catch {
 setStatus({ running: false, certExists: false, dnsStatus: {} });
 }
 };

 const handleAction = (action: string) => {
 setActionError(null);
 if (isWindows || status?.hasCachedPassword) {
 doAction(action, "");
 } else {
 setPendingAction(action);
 setShowPasswordModal(true);
 setModalError(null);
 }
 };

 const doAction = async (action: string, password: string) => {
 setLoading(true);
 setActionError(null);
 try {
 let res;
 if (action === "trust-cert") {
 res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ action: "trust-cert", sudoPassword: password }),
 });
 } else if (action === "start") {
 const keyToUse = selectedApiKey?.trim()
 || (apiKeys?.length > 0 ? apiKeys[0].key : null)
 || (!cloudEnabled ? "sk_8router" : null);
 res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 apiKey: keyToUse,
 sudoPassword: password,
 mitmRouterBaseUrl: mitmRouterBaseUrl.trim() || DEFAULT_MITM_ROUTER_BASE,
 }),
 });
 } else {
 res = await fetch("/api/cli-tools/antigravity-mitm", {
 method: "DELETE",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ sudoPassword: password }),
 });
 }
 if (!res.ok) {
 const data = await res.json().catch(() => ({}));
 setActionError(data.error || `Failed to ${action} MITM server`);
 return;
 }
 setShowPasswordModal(false);
 setSudoPassword("");
 await fetchStatus();
 } catch (e: any) {
 setActionError(e.message || "Network error");
 } finally {
 setLoading(false);
 setPendingAction(null);
 }
 };

 const handleConfirmPassword = () => {
 if (!sudoPassword.trim()) {
 setModalError("Sudo password is required");
 return;
 }
 if (pendingAction) doAction(pendingAction, sudoPassword);
 };

 const isRunning = !!status?.running;

 return (
 <>
 <Card className="border-primary/20 bg-primary/5 p-4 rounded-none shadow-none">
 <div className="flex flex-col gap-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Shield className="size-5 text-primary" weight="bold" />
 <span className="font-bold text-xs uppercase tracking-widest text-foreground">MITM Service Engine</span>
 {isRunning ? (
 <Badge className="h-5 px-1.5 text-[9px] font-bold uppercase bg-primary/10 text-primary border-none rounded-none">Running</Badge>
 ) : (
 <Badge variant="secondary" className="h-5 px-1.5 text-[9px] font-bold uppercase border-none rounded-none opacity-40">Stopped</Badge>
 )}
 </div>
 <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {[
 { label: "Cert", ok: status?.certExists },
 { label: "Trusted", ok: status?.certTrusted },
 { label: "Server", ok: isRunning },
 ].map(({ label, ok }) => (
 <div key={label} className="flex items-center gap-1">
 {ok ? <CheckCircle className="size-3 text-primary" weight="bold" /> : <XCircle className="size-3 text-muted-foreground" weight="bold" />}
 <span className={cn(ok ? "text-primary opacity-100" : "opacity-40")}>{label}</span>
 </div>
 ))}
 </div>
 </div>

 {/* Purpose & Info */}
 <div className="p-3 rounded-none bg-background/50 border border-border/50 flex flex-col gap-2.5">
 <p className="text-[10px] text-muted-foreground font-medium leading-relaxed italic">
 <span className="font-bold text-foreground uppercase tracking-widest opacity-60 not-italic mr-1.5">Goal:</span> 
 Intercept native IDE traffic (Antigravity, Copilot) to use custom 8Router models.
 </p>
 </div>

 {/* Config Grid */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1.5">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Infrastructure Node URL</label>
 <Input
 type="text"
 value={mitmRouterBaseUrl}
 onChange={(e) => setMitmRouterBaseUrl(e.target.value)}
 placeholder={DEFAULT_MITM_ROUTER_BASE}
 disabled={isRunning}
 className="h-9 text-xs rounded-none border-border/50 bg-background focus-visible:ring-0 focus-visible:border-primary/50 transition-colors"
 />
 </div>
 {!isRunning && (
 <div className="space-y-1.5">
 <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Credential Key</label>
 {apiKeys?.length > 0 ? (
 <select
 value={selectedApiKey}
 onChange={(e) => setSelectedApiKey(e.target.value)}
 className="w-full h-9 px-3 bg-background border border-border/50 rounded-none text-xs font-bold focus:outline-none focus:border-primary/50 transition-colors"
 >
 {apiKeys.map((key) => (
 <option key={key.id} value={key.key}>
 {key.key}
 </option>
 ))}
 </select>
 ) : (
 <div className="h-9 flex items-center px-3 bg-muted/10 border border-border/50 border-dashed rounded-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
 {cloudEnabled ? translate("NO ACTIVE KEYS") : "sk_8router (INTERNAL)"}
 </div>
 )}
 </div>
 )}
 </div>

 {/* Action Bar */}
 <div className="flex items-center gap-2 flex-wrap border-t border-border/40 pt-4">
 {status?.certExists && !status?.certTrusted && (
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleAction("trust-cert")}
 disabled={loading}
 className="h-8 rounded-none border-border/50 text-[10px] font-bold uppercase tracking-widest hover:bg-primary/10 hover:text-primary transition-colors"
 >
 <ShieldCheck className="size-3.5 mr-1.5" weight="bold" />
 Trust Root CA
 </Button>
 )}
 {isRunning ? (
 <Button
 variant="destructive"
 size="sm"
 onClick={() => handleAction("stop")}
 disabled={loading}
 className="h-8 rounded-none border-none bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-widest hover:bg-destructive/20 transition-colors"
 >
 <StopCircle className="size-3.5 mr-1.5" weight="bold" />
 Shutdown Server
 </Button>
 ) : (
 <Button
 size="sm"
 onClick={() => handleAction("start")}
 disabled={loading || (isWindows && !isAdmin)}
 className="h-8 rounded-none border-none text-[10px] font-bold uppercase tracking-widest px-6 shadow-none"
 >
 <PlayCircle className="size-3.5 mr-1.5" weight="bold" />
 Provision Node
 </Button>
 )}
 {isRunning && (
 <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 ml-auto italic">Service active. Map tools below to activate DNS interception.</p>
 )}
 </div>

 {/* Feedback Alerts */}
 {actionError && (
 <div className="flex items-start gap-2 px-3 py-2 rounded-none text-[10px] font-bold uppercase tracking-widest bg-destructive/5 text-destructive border border-destructive/20 mt-2">
 <AlertCircle className="size-3.5 mt-0.5 shrink-0" weight="bold" />
 <span>{actionError}</span>
 </div>
 )}

 {isWindows && !isAdmin && (
 <div className="flex items-center gap-2 px-3 py-2 rounded-none text-[10px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 border border-amber-500/20 mt-2">
 <Shield className="size-3.5" weight="bold" />
 <span>Elevated Privileges Required — Restart as Administrator to use MITM features</span>
 </div>
 )}
 </div>
 </Card>

 {/* Password Modal */}
 {showPasswordModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
 <div className="bg-background border border-border/50 rounded-none p-6 w-full max-w-sm flex flex-col gap-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
 <div className="space-y-1">
 <h3 className="text-lg font-bold tracking-tight text-foreground uppercase">Authority Challenge</h3>
 <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Sudo credentials required for SSL/DNS modification.</p>
 </div>
 <div className="flex items-start gap-3 p-3 bg-muted/30 border border-border/50 rounded-none">
 <AlertTriangle className="size-5 text-amber-500 shrink-0" weight="bold" />
 <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">Required for SSL certificate installation and hosts file management.</p>
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
 </>
 );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
 Plus, 
 CaretUp, 
 CaretDown, 
 Key, 
 Lock, 
 Network, 
 ArrowsClockwise as RefreshCw, 
 Pencil, 
 Trash, 
 Timer,
 ShieldCheck,
 Check
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
 Card, 
 CardContent, 
 CardHeader, 
 CardTitle, 
 CardFooter 
} from "@/components/ui/card";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogFooter,
 DialogDescription,
} from "@/components/ui/dialog";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
 DropdownMenuLabel,
 DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import EditConnectionModal from "@/shared/components/EditConnectionModal";

interface Connection {
  id: string;
  provider: string;
  authType: string;
  isActive: boolean;
  testStatus: string;
  priority: number;
  name?: string;
  email?: string;
  lastError?: string;
  providerSpecificData?: {
    proxyPoolId?: string | null;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface ProxyPool {
  id: string;
  name: string;
  isActive?: boolean;
}

// --- Helpers ---

function CooldownTimer({ until }: { until: string }) {
 const [remaining, setRemaining] = useState("");
 useEffect(() => {
 const update = () => {
 const diff = new Date(until).getTime() - Date.now();
 if (diff <= 0) { setRemaining(""); return; }
 const s = Math.floor(diff / 1000);
 if (s < 60) setRemaining(`${s}s`);
 else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
 else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
 };
 update();
 const t = setInterval(update, 1000);
 return () => clearInterval(t);
 }, [until]);
 if (!remaining) return null;
 return <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums bg-muted/30 px-1.5 py-0.5 rounded border border-border/50"><Timer className="size-2.5"/> {remaining}</div>;
}

function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete }: {
  connection: Connection;
  proxyPools: ProxyPool[];
  isOAuth: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: (active: boolean) => void;
  onUpdateProxy: (poolId: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
 const [isCooldown, setIsCooldown] = useState(false);
 const proxyPoolMap = new Map((proxyPools || []).map((p) => [p.id, p]));
 const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
 const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
 const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
 const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

 const modelLockUntil = Object.entries(connection).filter(([k]) => k.startsWith("modelLock_")).map(([, v]) => v as string).filter(Boolean).sort()[0] || null;
 useEffect(() => {
 const check = () => {
 const until = Object.entries(connection).filter(([k]) => k.startsWith("modelLock_")).map(([, v]) => v as string).filter(v => v && new Date(v).getTime() > Date.now()).sort()[0] || null;
 setIsCooldown(!!until);
 };
 check();
 const t = modelLockUntil ? setInterval(check, 1000) : null;
 return () => { if (t) clearInterval(t); };
 }, [modelLockUntil, connection]);

 const effectiveStatus = connection.testStatus ==="unavailable"&& !isCooldown ?"active": connection.testStatus;
 const getStatusBadge = () => {
 if (connection.isActive === false) return <Badge variant="secondary" className="h-4 text-[10px] font-bold uppercase tabular-nums opacity-50 border-none">DISABLED</Badge>;
 if (effectiveStatus ==="active"|| effectiveStatus ==="success") return <Badge className="h-4 text-[10px] font-bold uppercase tabular-nums bg-primary/10 text-primary border-none">ACTIVE</Badge>;
 if (effectiveStatus ==="error"|| effectiveStatus ==="expired"|| effectiveStatus ==="unavailable") return <Badge variant="destructive" className="h-4 text-[10px] font-bold uppercase tabular-nums border-none">ERROR</Badge>;
 return <Badge variant="outline" className="h-4 text-[10px] font-bold uppercase tabular-nums border-border/50">{effectiveStatus || "UNKNOWN"}</Badge>;
 };

 return (
 <div className={cn("p-3 flex items-center justify-between hover:bg-muted/10 transition-colors group border-b border-border/40 last:border-0", connection.isActive === false &&"opacity-60 grayscale")}>
 <div className="flex items-center gap-4 min-w-0 flex-1">
 <div className="flex flex-col gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity">
 <Button variant="ghost" size="icon" className="size-5 rounded-md hover:bg-muted" onClick={onMoveUp} disabled={isFirst}><CaretUp className="size-3"/></Button>
 <Button variant="ghost" size="icon" className="size-5 rounded-md hover:bg-muted" onClick={onMoveDown} disabled={isLast}><CaretDown className="size-3"/></Button>
 </div>
 <div className="size-8 rounded border border-border/50 bg-background flex items-center justify-center shrink-0 shadow-none">
 {isOAuth ? <Lock className="size-3.5 text-muted-foreground" weight="bold"/> : <Key className="size-3.5 text-muted-foreground" weight="bold"/>}
 </div>
 <div className="min-w-0 flex-1 space-y-1">
 <div className="flex items-center gap-2">
 <span className="text-sm font-semibold tracking-tight truncate">{isOAuth ? (connection.name || connection.email || "OAuth Account") : connection.name}</span>
 {getStatusBadge()}
 {hasAnyProxy && <Badge variant="secondary" className={cn("h-4 text-[10px] font-bold uppercase tabular-nums border-none", boundProxyPool?.isActive ?"bg-primary/10 text-primary":"bg-muted/30 text-muted-foreground")}>PROXY</Badge>}
 <span className="text-[10px] font-bold text-muted-foreground/40 tabular-nums uppercase tracking-widest">#{connection.priority}</span>
 </div>
 <div className="flex items-center gap-2">
 {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil as string} />}
 {connection.lastError && connection.isActive !== false && <span className="text-xs font-medium text-destructive truncate" title={connection.lastError}>{connection.lastError}</span>}
 </div>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all gap-1">
 <DropdownMenu>
 <DropdownMenuTrigger render={
 <Button variant="ghost" size="icon" className={cn("size-8 rounded-full", hasAnyProxy ?"text-primary":"text-muted-foreground hover:text-primary")}><Network className="size-3.5"/></Button>
 } />
 <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-none border-border/50">
 <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Route Via Proxy</DropdownMenuLabel>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-xs font-medium gap-2" onClick={() => onUpdateProxy(null)}>None {!boundProxyPoolId && <Check className="size-3 ml-auto"/>}</DropdownMenuItem>
 {proxyPools.map(p => (
 <DropdownMenuItem key={p.id} className="text-xs font-medium gap-2" onClick={() => onUpdateProxy(p.id)}>{p.name} {boundProxyPoolId === p.id && <Check className="size-3 ml-auto"/>}</DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-primary" onClick={onEdit}><Pencil className="size-3.5"/></Button>
 <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-destructive" onClick={onDelete}><Trash className="size-3.5"/></Button>
 </div>
 <Switch checked={connection.isActive ?? true} onCheckedChange={onToggleActive} className="scale-75 data-[state=checked]:bg-primary" />
 </div>
 </div>
 );
}

function AddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }: {
  isOpen: boolean;
  provider: string;
  providerName: string;
  proxyPools: ProxyPool[];
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
 const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: "__none__" });
 const [validating, setValidating] = useState(false);
 const [validationResult, setValidationResult] = useState<string | null>(null);
 const [saving, setSaving] = useState(false);

 const handleValidate = async () => {
 setValidating(true);
 try {
 const res = await fetch("/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey: formData.apiKey }) });
 const data = res.ok ? await res.json() : { valid: false };
 setValidationResult(data.valid ? "success" : "failed");
 } catch { setValidationResult("failed"); } finally { setValidating(false); }
 };

 const handleSubmit = async () => {
 if (!provider || !formData.apiKey) return;
 setSaving(true);
 try {
 await onSave({ ...formData, proxyPoolId: formData.proxyPoolId === "__none__" ? null : formData.proxyPoolId, testStatus: validationResult === 'success' ? 'active' : 'unknown' });
 } finally { setSaving(false); }
 };

 return (
 <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
 <DialogContent className="sm:max-w-md border-border/50 shadow-none">
 <DialogHeader>
 <DialogTitle className="text-lg font-semibold tracking-tight">Link {providerName || provider} Key</DialogTitle>
 <DialogDescription className="text-xs font-medium">Add a new API credential for infrastructure routing.</DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-4">
 <div className="grid gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Label</Label>
 <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Production Cluster" className="h-9 text-sm bg-muted/10 border-border/40" />
 </div>
 <div className="space-y-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">API Token</Label>
 <div className="flex gap-2">
 <Input type="password" value={formData.apiKey} onChange={e => setFormData({ ...formData, apiKey: e.target.value })} placeholder="sk-..." className="flex-1 h-9 text-sm bg-muted/10 border-border/40" />
 <Button variant="outline" size="sm" onClick={handleValidate} disabled={!formData.apiKey || validating} className="h-9 px-4 text-xs font-bold uppercase tracking-wider">{validating ? <RefreshCw className="size-3 animate-spin"/> : "Verify"}</Button>
 </div>
 {validationResult && <Badge variant={validationResult === 'success' ? 'secondary' : 'destructive'} className="h-4 text-[10px] font-bold uppercase border-none">{validationResult === 'success' ? 'TOKEN VALID' : 'TOKEN FAIL'}</Badge>}
 </div>
 <div className="grid grid-cols-2 gap-4">
 <div className="grid gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Priority</Label>
 <Input type="number" value={formData.priority} onChange={e => setFormData({ ...formData, priority: parseInt(e.target.value) || 1 })} className="h-9 text-sm bg-muted/10 border-border/40" />
 </div>
 <div className="grid gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Proxy Hub</Label>
 <Select value={formData.proxyPoolId} onValueChange={v => setFormData({ ...formData, proxyPoolId: v as string })}>
 <SelectTrigger className="h-9 text-xs bg-muted/10 border-border/40 shadow-none"><SelectValue /></SelectTrigger>
 <SelectContent className="shadow-none border-border/50">
 <SelectItem value="__none__" className="text-xs font-medium">None</SelectItem>
 {proxyPools.map(p => <SelectItem key={p.id} value={p.id} className="text-xs font-medium">{p.name}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 </div>
 </div>
 <DialogFooter className="bg-muted/5 p-4 border-t border-border/50">
 <Button variant="ghost" className="font-bold text-[10px] uppercase tracking-widest" onClick={onClose}>Cancel</Button>
 <Button className="font-bold text-[10px] uppercase tracking-widest px-8" onClick={handleSubmit} disabled={saving || !formData.apiKey || !formData.name}>{saving ? "Saving..." : "Connect"}</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

// --- ConnectionsCard ---

export default function ConnectionsCard({ providerId, isOAuth }: { providerId: string; isOAuth: boolean }) {
 const [connections, setConnections] = useState<Connection[]>([]);
 const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
 const [loading, setLoading] = useState(true);
 const [showAddModal, setShowAddModal] = useState(false);
 const [showEditModal, setShowEditModal] = useState(false);
 const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
 const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
 const [providerStickyLimit, setProviderStickyLimit] = useState("1");

 const fetch_ = useCallback(async () => {
 try {
 const [connRes, proxyRes, settingsRes] = await Promise.all([fetch("/api/providers"), fetch("/api/proxy-pools?isActive=true"), fetch("/api/settings")]);
 const connData = await connRes.json();
 const proxyData = await proxyRes.json();
 const settingsData = await settingsRes.ok ? await settingsRes.json() : {};
 if (connRes.ok) setConnections((connData.connections || []).filter((c: Connection) => c.provider === providerId));
 if (proxyRes.ok) setProxyPools(proxyData.proxyPools || []);
 const override = (settingsData.providerStrategies || {})[providerId] || {};
 setProviderStrategy(override.fallbackStrategy || null);
 setProviderStickyLimit(String(override.stickyRoundRobinLimit || "1"));
 } catch (e) { console.log(e); } finally { setLoading(false); }
 }, [providerId]);

 useEffect(() => { fetch_(); }, [fetch_]);

 const saveStrategy = async (strategy: string | null, stickyLimit: string) => {
 try {
 const res = await fetch("/api/settings");
 const data = res.ok ? await res.json() : {};
 const current = data.providerStrategies || {};
 const override = strategy ? { fallbackStrategy: strategy, stickyRoundRobinLimit: parseInt(stickyLimit) || 1 } : {};
 const updated = { ...current }; if (strategy) updated[providerId] = override; else delete updated[providerId];
 await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
 } catch (e) { console.log(e); }
 };

 return (
 <>
 <Card className="border-border/50 p-0 overflow-hidden shadow-none rounded-lg">
 <CardHeader className="flex flex-row items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/10">
 <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">Gateway Node Routing</CardTitle>
 <div className="flex items-center gap-4">
 <div className="flex items-center gap-2">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Round Robin</span>
 <Switch checked={providerStrategy === 'round-robin'} onCheckedChange={e => { const s = e ? 'round-robin' : null; setProviderStrategy(s); saveStrategy(s, providerStickyLimit); }} className="scale-[0.6] data-[state=checked]:bg-primary"/>
 </div>
 {providerStrategy === 'round-robin' && (
 <div className="flex items-center gap-2">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Sticky</span>
 <Input type="number" min={1} value={providerStickyLimit} onChange={e => { setProviderStickyLimit(e.target.value); saveStrategy('round-robin', e.target.value); }} className="h-6 w-10 px-1 py-0.5 text-xs font-bold tabular-nums text-center bg-background border-border/50 rounded-none shadow-none"/>
 </div>
 )}
 </div>
 </CardHeader>
 <CardContent className="p-0">
 {loading ? <div className="p-10 text-center opacity-20"><RefreshCw className="size-6 animate-spin mx-auto" weight="bold"/></div> : connections.length === 0 ? (
 <div className="py-12 flex flex-col items-center justify-center opacity-40 text-center gap-3">
 <ShieldCheck className="size-10" weight="bold"/>
 <p className="text-xs font-bold uppercase tracking-widest">No connections linked</p>
 </div>
 ) : (
 <div className="flex flex-col divide-y divide-border/50">
 {connections.map((c, i) => (
 <ConnectionRow 
 key={c.id} connection={c} proxyPools={proxyPools} isOAuth={isOAuth} isFirst={i === 0} isLast={i === connections.length - 1}
 onMoveUp={() => { const next = [...connections]; [next[i-1], next[i]] = [next[i], next[i-1]]; setConnections(next); }}
 onMoveDown={() => { const next = [...connections]; [next[i], next[i+1]] = [next[i+1], next[i]]; setConnections(next); }}
 onToggleActive={isActive => { fetch(`/api/providers/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }) }).then(() => fetch_()); }}
 onUpdateProxy={proxyPoolId => { fetch(`/api/providers/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proxyPoolId }) }).then(() => fetch_()); }}
 onEdit={() => { setSelectedConnection(c); setShowEditModal(true); }}
 onDelete={() => { if(confirm("Delete link?")) fetch(`/api/providers/${c.id}`, { method: 'DELETE' }).then(() => fetch_()); }}
 />
 ))}
 </div>
 )}
 </CardContent>
 <CardFooter className="px-3 py-1.5 bg-muted/5 border-t border-border/50 justify-end">
 <Button size="xs" variant="outline" className="font-bold tracking-widest bg-background rounded-none border-border/60" onClick={() => setShowAddModal(true)}><Plus className="size-3 mr-1.5" weight="bold"/> ADD LINK</Button>
 </CardFooter>
 </Card>

 <AddApiKeyModal isOpen={showAddModal} provider={providerId} providerName={providerId} proxyPools={proxyPools} onClose={() => setShowAddModal(false)} onSave={async d => { await fetch("/api/providers", { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: providerId, ...d }) }); fetch_(); setShowAddModal(false); }} />
 <EditConnectionModal isOpen={showEditModal} connection={selectedConnection} proxyPools={proxyPools} onClose={() => setShowEditModal(false)} onSave={async d => { if (!selectedConnection) return; await fetch(`/api/providers/${selectedConnection.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); fetch_(); setShowEditModal(false); }} />
 </>
 );
}

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { 
  Plus, 
  CloudArrowUp, 
  Upload, 
  ArrowsClockwise as RefreshCw, 
  Play, 
  Trash, 
  PencilSimple as Edit2, 
  Globe, 
  Pulse,
  WarningCircle as AlertCircle,
  HardDrive as Server,
  Lightning as Zap,
  Info,
  Clock
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useNotificationStore } from "@/store/notificationStore";

interface ProxyPool {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy?: string;
  isActive: boolean;
  strictProxy?: boolean;
  type?: string;
  testStatus?: string;
  lastTestedAt?: string | null;
  lastError?: string | null;
  boundConnectionCount?: number;
}

interface ProxyPoolsPageClientProps {
  initialData: {
    proxyPools: ProxyPool[];
    settings: {
      cloudEnabled: boolean;
    };
    machineId: string;
  };
}

function getStatusBadge(status?: string) {
  if (status === "active") return <Badge className="h-5 rounded-md border-none bg-primary/10 text-[10px] text-primary">Active</Badge>;
  if (status === "error") return <Badge variant="destructive" className="h-5 rounded-md border-none text-[10px]">Error</Badge>;
  return <Badge variant="outline" className="h-5 rounded-md border-border/50 text-[10px] text-muted-foreground opacity-70">{status || "Unknown"}</Badge>;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function normalizeFormData(data: Partial<ProxyPool> = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPageClient({ initialData }: ProxyPoolsPageClientProps) {
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>(initialData?.proxyPools || []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState<ProxyPool | null>(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const notify = useNotificationStore();

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    }
  }, []);

  const handleSave = async () => {
    const payload = {
      ...formData,
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool?.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        setShowFormModal(false);
        notify.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      notify.error("Failed to save proxy pool");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool: ProxyPool) => {
    if (!confirm(`Delete proxy pool "${proxyPool.name}"?`)) return;

    try {
      const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
      if (res.ok) {
        setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
        notify.success("Proxy pool deleted");
        return;
      }
      const data = await res.json();
      notify.error(data.error || "Delete failed");
    } catch (error) {
      notify.error("Failed to delete proxy pool");
    }
  };

  const handleTest = async (proxyPoolId: string) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();
      await fetchProxyPools();
      if (data.ok) notify.success("Proxy test successful");
      else notify.warning("Proxy test failed");
    } catch (error) {
      notify.error("Test request failed");
    } finally {
      setTestingId(null);
    }
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        setShowVercelModal(false);
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deployment failed");
      }
    } catch (error) {
      notify.error("Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleBatchImport = async () => {
    const lines = batchImportText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch("/api/proxy-pools/batch-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      if (res.ok) {
        await fetchProxyPools();
        setShowBatchImportModal(false);
        notify.success("Proxy batch imported successfully");
      }
    } catch (error) {
      notify.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="size-4" weight="bold"/>
            System Node
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Proxy Hubs</h1>
          <p className="text-sm text-muted-foreground">
            Provision re-usable egress proxies for infrastructure routing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-md border-border/50 bg-background px-3 text-xs font-medium" onClick={() => setShowVercelModal(true)}>
            <CloudArrowUp className="mr-1.5 size-3.5" weight="bold"/> Vercel Relay
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-md border-border/50 bg-background px-3 text-xs font-medium" onClick={() => setShowBatchImportModal(true)}>
            <Upload className="mr-1.5 size-3.5" weight="bold"/> Batch Import
          </Button>
          <Button size="sm" className="h-8 rounded-md px-5 text-xs font-medium shadow-none" onClick={() => { setEditingProxyPool(null); setFormData(normalizeFormData()); setShowFormModal(true); }}>
            <Plus className="mr-1.5 size-3.5" weight="bold"/> New Hub
          </Button>
        </div>
      </header>

      {/* Stats Quick View */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total Pools" value={proxyPools.length} icon={Server} />
        <StatCard label="Operational" value={proxyPools.filter(p => p.isActive).length} icon={Zap} color="text-primary" />
        <StatCard label="Linked Nodes" value={proxyPools.reduce((acc, p) => acc + (p.boundConnectionCount || 0), 0)} icon={Pulse} color="text-primary" />
      </div>

      {/* Main List */}
      <Card className="border-border/50 overflow-hidden shadow-none rounded-none bg-background/50">
        <CardHeader className="border-b border-border/50 bg-muted/10 px-4 py-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">Active Egress Registry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {proxyPools.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Globe className="mb-4 size-16 text-muted-foreground" weight="bold"/>
              <p className="text-sm font-medium text-foreground">No egress hubs provisioned</p>
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {proxyPools.map((pool) => (
                <div key={pool.id} className={cn("p-4 hover:bg-muted/30 transition-all flex items-center justify-between group", !pool.isActive && "opacity-60")}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{pool.name}</span>
                      {getStatusBadge(pool.testStatus)}
                      {pool.type === "vercel" && <Badge className="h-4 rounded-md border-none bg-primary/10 px-1.5 text-[10px] text-primary">Vercel edge</Badge>}
                      <Badge variant="outline" className="h-4 rounded-md border-border/50 px-1.5 text-[10px] tabular-nums text-muted-foreground">{pool.boundConnectionCount || 0} links</Badge>
                    </div>
                    <code className="text-xs font-mono text-muted-foreground truncate block opacity-60 tabular-nums">{pool.proxyUrl}</code>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="size-3" weight="bold"/>
                        <span>Pulse: {formatDateTime(pool.lastTestedAt)}</span>
                      </div>
                      {pool.lastError && <span className="text-destructive">· {pool.lastError}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                    <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20" onClick={() => handleTest(pool.id)} disabled={testingId === pool.id} title="Health Check">
                      {testingId === pool.id ? <RefreshCw className="size-3.5 animate-spin" weight="bold"/> : <Play className="size-3.5" weight="bold"/>}
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-muted/50 border border-transparent hover:border-border/50" onClick={() => { setEditingProxyPool(pool); setFormData(normalizeFormData(pool)); setShowFormModal(true); }} title="Configure">
                      <Edit2 className="size-3.5" weight="bold"/>
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20" onClick={() => handleDelete(pool)} title="De-provision">
                      <Trash className="size-3.5" weight="bold"/>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Modals --- */}
      
      {/* Form Modal */}
      <Dialog open={showFormModal} onOpenChange={setShowFormModal}>
        <DialogContent className="sm:max-w-md border-border/50 shadow-none rounded-none p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-bold tracking-tight uppercase">{editingProxyPool ? "Configure Hub" : "Provision Hub"}</DialogTitle>
            <DialogDescription className="text-xs font-medium italic opacity-60">Manage your egress infrastructure parameters.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid gap-2">
              <Label htmlFor="pool-name" className="px-1 text-xs text-muted-foreground">Node Identity</Label>
              <Input id="pool-name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="US-WEST-EXIT-01" className="h-10 rounded-none border-border/50 bg-muted/5 text-sm"/>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pool-url" className="px-1 text-xs text-muted-foreground">Egress URL</Label>
              <Input id="pool-url" value={formData.proxyUrl} onChange={e => setFormData({ ...formData, proxyUrl: e.target.value })} placeholder="http://user:pass@host:port" className="font-mono text-xs h-10 rounded-none border-border/50 bg-muted/5"/>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pool-noproxy" className="px-1 text-xs text-muted-foreground">Bypass Manifest (No Proxy)</Label>
              <Input id="pool-noproxy" value={formData.noProxy} onChange={e => setFormData({ ...formData, noProxy: e.target.value })} placeholder="localhost, 127.0.0.1" className="font-mono text-xs h-10 rounded-none border-border/50 bg-muted/5"/>
            </div>
            
            <div className="flex items-center justify-between p-3 rounded-none border border-border/50 bg-muted/10">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Strict Routing</Label>
                <p className="text-[10px] text-muted-foreground font-medium italic">Enforce hub usage, fail fast on error.</p>
              </div>
              <Switch checked={formData.strictProxy} onCheckedChange={v => setFormData({ ...formData, strictProxy: v })} className="scale-75 data-[state=checked]:bg-primary" />
            </div>

            <div className="flex items-center justify-between p-3 rounded-none border border-border/50 bg-muted/10">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Service Status</Label>
              </div>
              <Switch checked={formData.isActive} onCheckedChange={v => setFormData({ ...formData, isActive: v })} className="scale-75 data-[state=checked]:bg-primary" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2 mt-4 p-0">
            <Button variant="outline" className="h-10 flex-1 rounded-md border-border/50 text-xs font-medium" onClick={() => setShowFormModal(false)}>Cancel</Button>
            <Button className="h-10 flex-1 rounded-md text-xs font-medium shadow-none" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Commit Hub"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vercel Modal */}
      <Dialog open={showVercelModal} onOpenChange={setShowVercelModal}>
        <DialogContent className="sm:max-w-md border-border/50 shadow-none rounded-none p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-bold tracking-tight uppercase">Provision Vercel Relay</DialogTitle>
            <DialogDescription className="text-xs font-medium italic opacity-60">Leverage Vercel Edge Network for identity obfuscation.</DialogDescription>
          </DialogHeader>
          <div className="bg-primary/10 border border-primary/20 p-4 rounded-none flex gap-3 mb-2">
            <Info className="size-5 text-primary shrink-0 mt-0.5" weight="bold"/>
            <div className="space-y-1">
              <p className="text-xs font-medium text-primary">Edge Obfuscation</p>
              <p className="text-[11px] leading-relaxed text-primary/80 font-medium italic">Deploys a custom relay function to the Vercel global edge. Requests will exit from Vercel dynamic IP space, preventing upstream provider rate limits based on source IP.</p>
            </div>
          </div>
          <div className="space-y-5 py-2">
            <div className="grid gap-2">
              <Label className="px-1 text-xs text-muted-foreground">Vercel Authority Token</Label>
              <Input type="password" value={vercelForm.vercelToken} onChange={e => setVercelForm({ ...vercelForm, vercelToken: e.target.value })} className="h-10 rounded-none border-border/50 bg-muted/5 font-mono text-sm" />
            </div>
            <div className="grid gap-2">
              <Label className="px-1 text-xs text-muted-foreground">Namespace / Project Name</Label>
              <Input value={vercelForm.projectName} onChange={e => setVercelForm({ ...vercelForm, projectName: e.target.value })} className="h-10 rounded-none border-border/50 bg-muted/5 font-mono text-sm uppercase" />
            </div>
          </div>
          <DialogFooter className="mt-4 p-0">
            <Button className="h-10 w-full rounded-md text-xs font-medium shadow-none" onClick={handleVercelDeploy} disabled={deploying || !vercelForm.vercelToken.trim()}>
              {deploying ? "Deploying Core..." : "Initiate Provisioning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Import Modal */}
      <Dialog open={showBatchImportModal} onOpenChange={setShowBatchImportModal}>
        <DialogContent className="max-w-2xl border-border/50 shadow-none rounded-none p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-bold tracking-tight uppercase">High-Volume Import</DialogTitle>
            <DialogDescription className="text-xs font-medium italic opacity-60">Bulk provision multiple egress nodes via manifest.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <textarea 
              className="w-full h-48 p-4 rounded-none border border-border/50 bg-muted/5 font-mono text-[11px] focus:ring-0 focus:border-primary/50 outline-none text-foreground/80 leading-relaxed shadow-none resize-none"
              placeholder={"# One proxy per line\nprotocol://user:pass@host:port\nhost:port:user:pass"}
              value={batchImportText}
              onChange={e => setBatchImportText(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2 mt-4 p-0">
            <Button variant="outline" className="h-10 flex-1 rounded-md border-border/50 text-xs font-medium" onClick={() => setShowBatchImportModal(false)}>Cancel</Button>
            <Button className="h-10 flex-1 rounded-md px-8 text-xs font-medium shadow-none" onClick={handleBatchImport} disabled={importing || !batchImportText.trim()}>{importing ? "Importing..." : "Commit Batch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string, value: string | number, icon: any, color?: string }) {
  return (
    <Card className="border-border/50 bg-muted/10 shadow-none overflow-hidden rounded-none hover:bg-muted/20 transition-colors">
      <CardContent className="p-4 flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
        </div>
        <div className={cn("p-2 rounded-none bg-background border border-border/50", color)}>
          <Icon className="size-4" weight="bold" />
        </div>
      </CardContent>
    </Card>
  );
}

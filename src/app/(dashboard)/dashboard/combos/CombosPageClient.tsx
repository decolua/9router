"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Plus, 
  Stack, 
  Copy, 
  Check, 
  PencilSimple, 
  Trash, 
  ArrowUp, 
  ArrowDown, 
  X,
  MagnifyingGlass,
  Lightning,
  Info
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
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import { translate } from "@/i18n/runtime";
import { ProviderConnection } from "@/lib/localDb";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

interface Combo {
  id: string;
  name: string;
  models: string[];
}

interface CombosPageClientProps {
  initialData: {
    combos: Combo[];
    settings: {
      comboStrategies: Record<string, any>;
    };
    connections: ProviderConnection[];
    machineId: string;
  };
}

export default function CombosPageClient({ initialData }: CombosPageClientProps) {
 const [combos, setCombos] = useState<Combo[]>(initialData?.combos || []);
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [loading, setLoading] = useState(false);
 const [showCreateModal, setShowCreateModal] = useState(false);
 const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
 const [activeProviders, setActiveProviders] = useState<ProviderConnection[]>(initialData?.connections || []);
 const [comboStrategies, setComboStrategies] = useState<Record<string, any>>(initialData?.settings?.comboStrategies || {});
 const { copied, copy } = useCopyToClipboard();

 const fetchData = async () => {
 try {
 const [combosRes, providersRes, settingsRes] = await Promise.all([
 fetch("/api/combos"),
 fetch("/api/providers"),
 fetch("/api/settings"),
 ]);
 const combosData = await combosRes.json();
 const providersData = await providersRes.json();
 const settingsData = settingsRes.ok ? await settingsRes.json() : {};
 
 if (combosRes.ok) setCombos(combosData.combos || []);
 if (providersRes.ok) setActiveProviders(providersData.connections || []);
 setComboStrategies(settingsData.comboStrategies || {});
 } catch (error) {
 console.log("Error fetching data:", error);
 }
 };

 const handleCreate = async (data: any) => {
 try {
 const res = await fetch("/api/combos", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(data),
 });
 if (res.ok) {
 await fetchData();
 setShowCreateModal(false);
 }
 } catch (error) { console.log(error); }
 };

 const handleUpdate = async (id: string, data: any) => {
 try {
 const res = await fetch(`/api/combos/${id}`, {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(data),
 });
 if (res.ok) {
 await fetchData();
 setEditingCombo(null);
 }
 } catch (error) { console.log(error); }
 };

 const handleDelete = async (id: string) => {
 if (!confirm("Delete this combo?")) return;
 try {
 const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
 if (res.ok) setCombos(combos.filter(c => c.id !== id));
 } catch (error) { console.log(error); }
 };

 const handleToggleRoundRobin = async (comboName: string, enabled: boolean) => {
 try {
 const updated = { ...comboStrategies };
 if (enabled) updated[comboName] = { fallbackStrategy: "round-robin" };
 else delete updated[comboName];
 
 await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ comboStrategies: updated }),
 });
 setComboStrategies(updated);
 } catch (error) { console.log(error); }
 };

 return (
 <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
 {/* Header */}
 <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
 <div className="space-y-1">
 <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase tracking-tight">
 <Stack className="size-4" weight="bold" />
 Infrastructure
 </div>
 <h1 className="text-3xl font-medium tracking-tight text-foreground uppercase">Intelligence Combos</h1>
 <p className="text-sm text-muted-foreground font-medium italic opacity-70">
 Define virtual model groups with autonomous fallback strategies.
 </p>
 </div>

 <Button size="sm" className="font-bold text-[10px] uppercase tracking-widest h-8 px-5 rounded-none shadow-none" onClick={() => setShowCreateModal(true)}>
 <Plus className="size-3.5 mr-1.5" weight="bold" /> New Combo
 </Button>
 </header>

 {/* Combos List */}
 <div className="grid gap-3">
 {combos.length === 0 ? (
 <Card className="border-border/50 border-dashed bg-muted/5 py-20 text-center flex flex-col items-center justify-center opacity-10 grayscale rounded-none">
 <Stack className="size-16 mb-4" weight="bold" />
 <p className="text-xs font-bold uppercase tracking-[0.3em]">No combos provisioned</p>
 </Card>
 ) : (
 combos.map((combo) => (
 <ComboCard
 key={combo.id}
 combo={combo}
 copied={copied}
 onCopy={copy}
 onEdit={() => setEditingCombo(combo)}
 onDelete={() => handleDelete(combo.id)}
 roundRobinEnabled={comboStrategies[combo.name]?.fallbackStrategy === "round-robin"}
 onToggleRoundRobin={(enabled) => handleToggleRoundRobin(combo.name, enabled)}
 />
 ))
 )}
 </div>

 <ComboFormModal
 key="create"
 isOpen={showCreateModal}
 onClose={() => setShowCreateModal(false)}
 onSave={handleCreate}
 activeProviders={activeProviders as any}
 />

 {editingCombo && (
 <ComboFormModal
 key={editingCombo.id}
 isOpen={!!editingCombo}
 combo={editingCombo}
 onClose={() => setEditingCombo(null)}
 onSave={(data) => handleUpdate(editingCombo.id, data)}
 activeProviders={activeProviders as any}
 />
 )}
 </div>
 );
}

function ComboCard({ combo, copied, onCopy, onEdit, onDelete, roundRobinEnabled, onToggleRoundRobin }: {
  combo: Combo;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  roundRobinEnabled: boolean;
  onToggleRoundRobin: (enabled: boolean) => void;
}) {
 return (
 <Card className="border-border/50 overflow-hidden p-0 rounded-none shadow-none bg-background/50 group">
 <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
 <div className="flex items-center gap-4 min-w-0 flex-1">
 <div className="size-10 rounded-none bg-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
 <Stack className="size-5 text-primary" weight="bold" />
 </div>
 <div className="min-w-0 flex-1 space-y-1">
 <div className="flex items-center gap-2.5">
 <code className="text-sm font-bold font-mono tracking-tight text-foreground truncate uppercase">{combo.name}</code>
 <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-bold uppercase border-border/50 text-muted-foreground/60 rounded-none tabular-nums">{combo.models.length} PIPELINE SLOTS</Badge>
 </div>
 <div className="flex items-center gap-1.5 flex-wrap">
 {combo.models.slice(0, 5).map((model, index) => (
 <code key={index} className="text-[10px] font-mono bg-muted/40 px-1.5 py-0.5 rounded-none text-muted-foreground/80 border border-border/40 tabular-nums">
 {model}
 </code>
 ))}
 {combo.models.length > 5 && (
 <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">+{combo.models.length - 5} more</span>
 )}
 </div>
 </div>
 </div>

 <div className="flex items-center justify-between md:justify-end gap-8 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-border/20">
 <div className="flex items-center gap-2.5">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Load Balance</span>
 <Switch checked={roundRobinEnabled} onCheckedChange={onToggleRoundRobin} className="scale-75 data-[state=checked]:bg-primary" />
 </div>

 <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
 <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-primary/10 text-muted-foreground hover:text-primary" onClick={() => onCopy(combo.name, `combo-${combo.id}`)}>
 {copied === `combo-${combo.id}` ? <Check className="size-3.5 text-primary" weight="bold" /> : <Copy className="size-3.5" weight="bold" />}
 </Button>
 <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-muted/5 text-muted-foreground hover:text-foreground" onClick={onEdit}>
 <PencilSimple className="size-3.5" weight="bold" />
 </Button>
 <Button variant="ghost" size="icon" className="size-8 rounded-none hover:bg-destructive/10 text-muted-foreground hover:text-destructive" onClick={onDelete}>
 <Trash className="size-3.5" weight="bold" />
 </Button>
 </div>
 </div>
 </div>
 </Card>
 );
}

function ModelItemRow({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: {
  index: number;
  model: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (val: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
 const [editing, setEditing] = useState(false);
 const [draft, setDraft] = useState(model);

 const commit = () => {
 const trimmed = draft.trim();
 if (trimmed && trimmed !== model) onEdit(trimmed);
 else setDraft(model);
 setEditing(false);
 };

 return (
 <div className="flex items-center gap-2.5 p-2 rounded-none border border-border/40 bg-muted/5 group/item transition-colors hover:bg-muted/10">
 <span className="text-[10px] font-black text-muted-foreground/30 w-4 text-center shrink-0 tabular-nums">{index + 1}</span>
 {editing ? (
 <Input 
 autoFocus 
 value={draft} 
 onChange={e => setDraft(e.target.value)} 
 onBlur={commit} 
 onKeyDown={e => e.key === "Enter" && commit()} 
 className="h-7 text-xs font-mono py-0 flex-1 bg-background rounded-none border-primary/30 focus-visible:ring-0"
 />
 ) : (
 <div className="flex-1 min-w-0 text-xs font-mono font-medium truncate cursor-text text-foreground/70" onClick={() => setEditing(true)}>
 {model}
 </div>
 )}
 <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
 <Button variant="ghost" size="icon" className="size-6 rounded-none text-muted-foreground hover:text-primary" onClick={onMoveUp} disabled={isFirst}><ArrowUp className="size-3" weight="bold" /></Button>
 <Button variant="ghost" size="icon" className="size-6 rounded-none text-muted-foreground hover:text-primary" onClick={onMoveDown} disabled={isLast}><ArrowDown className="size-3" weight="bold" /></Button>
 <Button variant="ghost" size="icon" className="size-6 rounded-none text-muted-foreground hover:text-destructive" onClick={onRemove}><X className="size-3" weight="bold" /></Button>
 </div>
 </div>
 );
}

interface ComboFormModalProps {
  isOpen: boolean;
  combo?: Combo | null;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  activeProviders: any[];
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders }: ComboFormModalProps) {
 const [name, setName] = useState(combo?.name || "");
 const [models, setModels] = useState<string[]>(combo?.models || []);
 const [showModelSelect, setShowModelSelect] = useState(false);
 const [saving, setSaving] = useState(false);
 const [nameError, setNameError] = useState("");
 const [modelAliases, setModelAliases] = useState<Record<string, string>>({});

 useEffect(() => {
 if (isOpen) {
 fetch("/api/models/alias").then(r => r.json()).then(d => setModelAliases(d.aliases || {}));
 }
 }, [isOpen]);

 const handleSave = async () => {
 if (!name.trim() || !VALID_NAME_REGEX.test(name)) {
 setNameError("Invalid identifier format");
 return;
 }
 if (models.length === 0) {
 alert("Add at least one intelligence node to the pipeline.");
 return;
 }
 setSaving(true);
 try {
 await onSave({ name: name.trim().toUpperCase(), models });
 } finally {
 setSaving(false);
 }
 };

 return (
 <>
 <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
 <DialogContent className="sm:max-w-md rounded-none border-border/50 shadow-none p-6">
 <DialogHeader className="mb-4">
 <DialogTitle className="text-lg font-bold tracking-tight uppercase">{combo ? "Configure Combo" : "Provision Combo"}</DialogTitle>
 <DialogDescription className="text-xs font-medium italic opacity-60">Define logic-gate for high-availability routing.</DialogDescription>
 </DialogHeader>
 <div className="space-y-5 py-2">
 <div className="grid gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Namespace Identifier</Label>
 <Input value={name} onChange={e => { setName(e.target.value); setNameError(""); }} placeholder="GPT-4-CLAUDE-STABLE" className="h-10 rounded-none border-border/50 bg-muted/5 font-mono uppercase"/>
 {nameError && <p className="text-[10px] text-destructive font-black uppercase px-1">{nameError}</p>}
 </div>

 <div className="space-y-2">
 <div className="flex items-center justify-between px-1">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Execution Pipeline</Label>
 <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-bold uppercase border-border/50 text-muted-foreground/40 rounded-none tabular-nums">{models.length} NODES</Badge>
 </div>
 
 <ScrollArea className="max-h-[300px] border border-border/40 bg-muted/5 p-1">
 <div className="space-y-1">
 {models.map((m, i) => (
 <ModelItemRow 
 key={i} 
 index={i} 
 model={m} 
 isFirst={i === 0} 
 isLast={i === models.length - 1}
 onEdit={val => { const next = [...models]; next[i] = val; setModels(next); }}
 onMoveUp={() => { const next = [...models]; [next[i-1], next[i]] = [next[i], next[i-1]]; setModels(next); }}
 onMoveDown={() => { const next = [...models]; [next[i], next[i+1]] = [next[i+1], next[i]]; setModels(next); }}
 onRemove={() => setModels(models.filter((_, idx) => idx !== i))}
 />
 ))}
 {models.length === 0 && (
 <div className="py-10 text-center border-2 border-dashed border-border/20 rounded-none opacity-20">
 <p className="text-[10px] font-bold uppercase tracking-widest">Pipeline Empty</p>
 </div>
 )}
 </div>
 </ScrollArea>
 
 <Button variant="outline" size="sm" className="w-full h-9 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-background hover:bg-muted/30" onClick={() => setShowModelSelect(true)}>
 <Plus className="size-3.5 mr-1.5" weight="bold" /> Add Intelligence Node
 </Button>
 </div>
 </div>
 <DialogFooter className="gap-2 sm:gap-2 mt-4 p-0">
 <Button variant="outline" className="font-bold text-[10px] uppercase tracking-widest flex-1 h-10 rounded-none border-border/50" onClick={onClose}>Cancel</Button>
 <Button className="font-bold text-[10px] uppercase tracking-widest flex-1 h-10 rounded-none shadow-none" onClick={handleSave} disabled={saving || !name.trim()}>{saving ? "Committing..." : "Commit Combo"}</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 <ModelSelectModal
 isOpen={showModelSelect}
 onClose={() => setShowModelSelect(false)}
 onSelect={m => !models.includes(m.value) && setModels([...models, m.value])}
 activeProviders={activeProviders}
 modelAliases={modelAliases}
 title="Select Node Pipeline Slot"
 />
 </>
 );
}

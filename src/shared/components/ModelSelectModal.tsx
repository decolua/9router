"use client";

import React, { useState, useMemo, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Layers, 
  Check, 
  Pencil as Edit2, 
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(id => (FREE_PROVIDERS as any)[id].noAuth);

interface Combo {
  id: string;
  name: string;
}

interface ProviderNode {
  id: string;
  name: string;
  prefix: string;
}

interface ProviderConnection {
  id: string;
  provider: string;
  name?: string;
  providerSpecificData?: {
    prefix?: string;
  };
}

interface ModelItem {
  id: string;
  name: string;
  value: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
}

interface GroupedModels {
  [providerId: string]: {
    name: string;
    alias: string;
    color: string;
    models: ModelItem[];
  };
}

interface ModelSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (model: ModelItem) => void;
  selectedModel?: string | null;
  activeProviders?: ProviderConnection[];
  title?: string;
  modelAliases?: Record<string, string>;
}

export default function ModelSelectModal({ isOpen, onClose, onSelect, selectedModel, activeProviders = [], title = "Select Model", modelAliases = {} }: ModelSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState<Combo[]>([]);
  const [providerNodes, setProviderNodes] = useState<ProviderNode[]>([]);

  useEffect(() => {
    if (isOpen) {
       fetch("/api/combos").then(r => r.json()).then(d => setCombos(d.combos || [])).catch(() => {});
       fetch("/api/provider-nodes").then(r => r.json()).then(d => setProviderNodes(d.nodes || [])).catch(() => {});
    }
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  const groupedModels = useMemo(() => {
    const groups: GroupedModels = {};
    const activeConnectionIds = activeProviders.map(p => p.provider);
    const providerIdsToShow = new Set([...activeConnectionIds, ...NO_AUTH_PROVIDER_IDS]);
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = (PROVIDER_ID_TO_ALIAS as any)[providerId] || providerId;
      const providerInfo = (allProviders as any)[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases).filter(([, f]) => f.startsWith(`${alias}/`)).map(([n, f]) => ({ id: f.replace(`${alias}/`, ""), name: n, value: f }));
        if (aliasModels.length > 0) groups[providerId] = { name: providerNodes.find(n => n.id === providerId)?.name || providerInfo.name, alias, color: providerInfo.color, models: aliasModels };
      } else if (isCustomProvider) {
        const conn = activeProviders.find(p => p.provider === providerId);
        const node = providerNodes.find(n => n.id === providerId);
        const prefix = conn?.providerSpecificData?.prefix || node?.prefix || providerId;
        const nodeModels = Object.entries(modelAliases).filter(([, f]) => f.startsWith(`${providerId}/`)).map(([n, f]) => ({ id: f.replace(`${providerId}/`, ""), name: n, value: `${prefix}/${f.replace(`${providerId}/`, "")}` }));
        groups[providerId] = { name: conn?.name || node?.name || providerInfo.name, alias: prefix, color: providerInfo.color, models: nodeModels.length ? nodeModels : [{ id: `__p__${providerId}`, name: `${prefix}/model-id`, value: `${prefix}/model-id`, isPlaceholder: true }] };
      } else {
        const hard = getModelsByProviderId(providerId);
        const hardIds = new Set(hard.map(m => m.id));
        const hasHard = hard.length > 0;
        const custom = Object.entries(modelAliases).filter(([n, f]) => f.startsWith(`${alias}/`) && (hasHard ? n === f.replace(`${alias}/`, "") : true) && !hardIds.has(f.replace(`${alias}/`, ""))).map(([n, f]) => ({ id: f.replace(`${alias}/`, ""), name: n, value: f, isCustom: true }));
        const all = [...hard.map(m => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` })), ...custom];
        if (all.length > 0) groups[providerId] = { name: providerInfo.name, alias, color: providerInfo.color, models: all };
      }
    });
    return groups;
  }, [activeProviders, modelAliases, allProviders, providerNodes]);

  const filteredCombos = useMemo(() => combos.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())), [combos, searchQuery]);
  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const f: GroupedModels = {};
    Object.entries(groupedModels).forEach(([pid, g]) => {
      const models = g.models.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
      if (models.length || g.name.toLowerCase().includes(q)) f[pid] = { ...g, models };
    });
    return f;
  }, [groupedModels, searchQuery]);

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-border/50 shadow-none">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
          <div className="relative mt-4">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground opacity-50" />
             <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search infrastructure models..." className="pl-9 h-10 rounded-xl bg-muted/10 border-border/40 focus-visible:bg-background transition-all shadow-none" />
          </div>
        </DialogHeader>

        <ScrollArea className="h-[450px] px-6 pb-6">
          <div className="space-y-6 pt-2">
            {filteredCombos.length > 0 && (
              <div className="space-y-3">
                 <div className="flex items-center gap-2 sticky top-0 bg-background py-1 z-10">
                    <Layers className="size-3.5 text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary">System Combos</span>
                 </div>
                 <div className="flex flex-wrap gap-2">
                    {filteredCombos.map(c => (
                      <button key={c.id} onClick={() => { onSelect({ id: c.name, name: c.name, value: c.name }); onClose(); }} className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all shadow-none", selectedModel === c.name ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 border-border/40 hover:border-primary/30")}>{c.name}</button>
                    ))}
                 </div>
              </div>
            )}

            {Object.entries(filteredGroups).map(([pid, g]) => (
              <div key={pid} className="space-y-3">
                 <div className="flex items-center gap-2 sticky top-0 bg-background py-1 z-10">
                    <div className="size-2 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{g.name}</span>
                 </div>
                 <div className="flex flex-wrap gap-2">
                    {g.models.map(m => (
                       <button key={m.id} onClick={() => { onSelect(m); onClose(); }} className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-2 shadow-none", selectedModel === m.value ? "bg-primary text-primary-foreground border-primary" : "bg-muted/10 border-border/40 hover:border-primary/30")}>
                          {m.isPlaceholder && <Edit2 className="size-3 opacity-50" />}
                          {m.name}
                          {m.isCustom && <Badge variant="outline" className="h-3.5 px-1 text-[10px] border-primary/20 text-primary font-bold uppercase rounded-none">CUSTOM</Badge>}
                          {selectedModel === m.value && <Check className="size-3" />}
                       </button>
                    ))}
                 </div>
              </div>
            ))}

            {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
              <div className="py-20 text-center opacity-30 flex flex-col items-center gap-2">
                 <SearchX className="size-10" />
                 <p className="text-[10px] font-bold uppercase tracking-widest">No models match your search</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

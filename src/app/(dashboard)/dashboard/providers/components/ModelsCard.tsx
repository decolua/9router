"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Card, Button, Modal } from "@/shared/components";
import { getModelsByProviderId } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { 
  CheckCircle, 
  XCircle, 
  Cpu, 
  Flask, 
  Check, 
  Copy, 
  X,
  Plus
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface Model {
  id: string;
  name?: string;
  isFree?: boolean;
  kinds?: string[];
  type?: string;
}

interface ModelRowProps {
  model: Model;
  fullModel: string;
  alias?: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  testStatus?: 'ok' | 'error' | null;
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  onSetAlias?: (alias: string) => Promise<void>;
}

// ── ModelRow ───────────────────────────────────────────────────
export function ModelRow({ 
  model, 
  fullModel, 
  copied, 
  onCopy, 
  testStatus, 
  isCustom, 
  isFree, 
  onDeleteAlias, 
  onTest, 
  isTesting 
}: ModelRowProps) {
  const borderColor = testStatus === "ok" ? "border-primary/20" : testStatus === "error" ? "border-destructive/20" : "border-border/50";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={cn(
      "group px-3 py-2 rounded-lg border bg-background/50 hover:bg-muted/10 transition-colors",
      borderColor
    )}>
      <div className="flex items-center gap-2">
        <div className="shrink-0" style={iconColor ? { color: iconColor } : undefined}>
          {testStatus === "ok" ? (
            <CheckCircle className="size-4" weight="bold" />
          ) : testStatus === "error" ? (
            <XCircle className="size-4" weight="bold" />
          ) : (
            <Cpu className="size-4" weight="bold" />
          )}
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded truncate w-fit max-w-full">{fullModel}</code>
          {model.name && <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest pl-1">{model.name}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onTest && (
            <div className="relative group/btn">
              <button 
                onClick={onTest} 
                disabled={isTesting} 
                className={cn(
                  "p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-primary transition-opacity",
                  isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                {isTesting ? (
                  <Flask className="size-3.5 animate-spin" weight="bold" />
                ) : (
                  <Flask className="size-3.5" weight="bold" />
                )}
              </button>
              <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded border border-border/50 whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity z-10">
                {isTesting ? translate("Testing...") : translate("Test")}
              </span>
            </div>
          )}
          <div className="relative group/btn">
            <button 
              onClick={() => onCopy(fullModel, `model-${model.id}`)} 
              className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-primary"
            >
              {copied === `model-${model.id}` ? (
                <Check className="size-3.5 text-primary" weight="bold" />
              ) : (
                <Copy className="size-3.5" weight="bold" />
              )}
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded border border-border/50 whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity z-10">
              {copied === `model-${model.id}` ? translate("Copied!") : translate("Copy")}
            </span>
          </div>
          {isFree && <span className="text-[9px] font-black tracking-widest text-primary bg-primary/10 px-1.5 py-0.5 rounded-none uppercase">FREE</span>}
          {isCustom && (
            <button 
              onClick={onDeleteAlias} 
              className="p-0.5 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
              title="Remove custom model"
            >
              <X className="size-3.5" weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AddCustomModelModal ────────────────────────────────────────
interface AddCustomModelModalProps {
  isOpen: boolean;
  onSave: (modelId: string) => void;
  onClose: () => void;
}

function AddCustomModelModal({ isOpen, onSave, onClose }: AddCustomModelModalProps) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal open={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">Model ID</label>
          <input
            className="w-full h-10 px-3 py-2 text-sm border border-border/50 rounded-none bg-muted/5 focus:outline-none focus:border-primary/50 transition-colors font-mono"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} className="flex-1 rounded-none font-bold text-[10px] uppercase tracking-widest h-10" disabled={!modelId.trim()}>Add Model</Button>
          <Button onClick={onClose} variant="ghost" className="flex-1 rounded-none font-bold text-[10px] uppercase tracking-widest h-10 border border-border/50">Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── ModelsCard ─────────────────────────────────────────────────
interface ModelsCardProps {
  providerId: string;
  kindFilter?: string;
}

interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
}

export default function ModelsCard({ providerId, kindFilter }: ModelsCardProps) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [modelTestResults, setModelTestResults] = useState<Record<string, 'ok' | 'error' | null>>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);

  const providerAlias = getProviderAlias(providerId);

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, connRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const connData = await connRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (connRes.ok) setConnections((connData.connections || []).filter((c: any) => c.provider === providerId));
    } catch (e) { console.log("ModelsCard fetch error:", e); }
  }, [providerId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSetAlias = async (modelId: string, alias: string) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) { console.log("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) { console.log("delete alias error:", e); }
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Get models — filter by kindFilter if provided
  const allModels = getModelsByProviderId(providerId);
  const displayModels = kindFilter
    ? allModels.filter((m: any) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        if (m.type) return m.type === kindFilter;
        return kindFilter === "llm";
      })
    : allModels;

  // Custom models added via alias
  const customModels = Object.entries(modelAliases)
    .filter(([alias, fullModel]) => {
      const prefix = `${providerAlias}/`;
      if (!fullModel.startsWith(prefix)) return false;
      const modelId = fullModel.slice(prefix.length);
      return !displayModels.some((m: any) => m.id === modelId) && alias === modelId;
    })
    .map(([alias, fullModel]) => ({
      id: fullModel.slice(`${providerAlias}/`.length),
      alias,
    }));

  return (
    <>
      <Card className="border-border/50 bg-background/50 p-4 rounded-none shadow-none">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/40">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">Intelligence Registry{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-[10px] font-bold uppercase tracking-wide text-destructive mb-3 break-words">{testError}</p>}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model: any) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                onDeleteAlias={() => existingAlias && handleDeleteAlias(existingAlias)}
                testStatus={modelTestResults[model.id]}
                onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
                isTesting={testingModelId === model.id}
                isFree={model.isFree}
              />
            );
          })}

          {customModels.map((model) => (
            <ModelRow
              key={model.id}
              model={{ id: model.id }}
              fullModel={`${providerAlias}/${model.id}`}
              alias={model.alias}
              copied={copied}
              onCopy={copy}
              onSetAlias={() => Promise.resolve()}
              onDeleteAlias={() => handleDeleteAlias(model.alias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelId === model.id}
              isCustom
            />
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddCustomModel(true)}
            className="h-auto border-dashed py-2 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/60 hover:bg-primary/5 hover:text-primary transition-all"
          >
            <Plus className="size-3.5 mr-1.5" weight="bold" />
            Add Intelligence
          </Button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleSetAlias(modelId, modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />
    </>
  );
}

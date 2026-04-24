"use client";

import React, { useState } from "react";
import { Download, Plus, Check, Copy, Trash, CheckCircle, XCircle, Cpu, Flask } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface CompatibleModelRowProps {
  modelId: string;
  fullModel: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: 'ok' | 'error' | 'testing' | null;
  isTesting?: boolean;
}

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }: CompatibleModelRowProps) {
  const borderClass = testStatus === "ok"
    ? "border-primary/20 bg-primary/5"
    : testStatus === "error"
    ? "border-destructive/20 bg-destructive/5"
    : "border-border/50";

  const iconClass = testStatus === "ok"
    ? "text-primary"
    : testStatus === "error"
    ? "text-destructive"
    : "text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-2 p-1.5 rounded-none border transition-colors hover:bg-muted/50", borderClass)}>
      <div className={cn("shrink-0", iconClass)}>
        {testStatus === "ok" ? (
          <CheckCircle className="size-3.5" weight="bold" />
        ) : testStatus === "error" ? (
          <XCircle className="size-3.5" weight="bold" />
        ) : (
          <Cpu className="size-3.5" weight="bold" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate tracking-tight">{modelId}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded-none leading-none truncate max-w-[150px]">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-accent rounded-none text-muted-foreground hover:text-foreground"
            >
              {copied === `model-${modelId}` ? (
                <Check className="size-3.5 text-primary" weight="bold" />
              ) : (
                <Copy className="size-3.5" weight="bold" />
              )}
            </button>
            <span className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded-none border border-border/50 shadow-none opacity-0 group-hover/btn:opacity-100 transition-opacity z-10">
              {copied === `model-${modelId}` ? translate("Copied!") : translate("Copy")}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-accent rounded-none text-muted-foreground hover:text-foreground transition-colors"
              >
                {isTesting ? (
                  <Spinner className="size-3.5 animate-spin" />
                ) : (
                  <Flask className="size-3.5" weight="bold" />
                )}
              </button>
              <span className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded-none border border-border/50 shadow-none opacity-0 group-hover/btn:opacity-100 transition-opacity z-10">
                {isTesting ? translate("Testing...") : translate("Test")}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-destructive/10 rounded-none text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove model"
      >
        <Trash className="size-3.5" weight="bold" />
      </button>
    </div>
  );
}

interface Connection {
  id: string;
  isActive: boolean;
}

interface CompatibleModelsSectionProps {
  providerStorageAlias: string;
  providerDisplayAlias: string;
  modelAliases: Record<string, string>;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onSetAlias: (modelId: string, alias: string, providerAliasOverride: string) => Promise<void>;
  onDeleteAlias: (alias: string) => void;
  connections: Connection[];
  isAnthropic?: boolean;
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias, connections, isAnthropic }: CompatibleModelsSectionProps) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, string>>({});

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerStorageAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerStorageAlias}/`, ""),
    fullModel,
    alias,
  }));

  const generateDefaultAlias = (modelId: string) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const resolveAlias = (modelId: string) => {
    const fullModel = `${providerStorageAlias}/${modelId}`;
    if (Object.values(modelAliases).includes(fullModel)) return null;
    const baseAlias = generateDefaultAlias(modelId);
    if (!modelAliases[baseAlias]) return baseAlias;
    const prefixedAlias = `${providerDisplayAlias}-${baseAlias}`;
    if (!modelAliases[prefixedAlias]) return prefixedAlias;
    return null;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      alert("All suggested aliases already exist.");
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
        importedCount += 1;
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground font-medium italic opacity-70">
        {translate("Add")} {isAnthropic ? "Anthropic" : "OpenAI"}-{translate("compatible models manually or import from /models.")}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1 flex flex-col gap-1">
          <Label
            htmlFor="new-compatible-model-input"
            className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60"
          >
            Model ID
          </Label>
          <Input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="h-8 text-xs bg-muted/10 border-border/50 rounded-none shadow-none"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={handleAdd}
            disabled={!newModel.trim() || adding}
            className="gap-1.5 font-bold uppercase tracking-wider rounded-none h-8"
          >
            <Plus className="size-3" weight="bold" data-icon="inline-start" />
            {adding ? translate("Adding") : translate("Add")}
          </Button>
          <Button
            size="xs"
            variant="secondary"
            onClick={handleImport}
            disabled={!canImport || importing}
            className="gap-1.5 font-bold uppercase tracking-wider rounded-none h-8"
          >
            <Download className="size-3" weight="bold" data-icon="inline-start" />
            {importing ? translate("Importing") : translate("Import")}
          </Button>
        </div>
      </div>

      {allModels.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <CompatibleModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={`${providerDisplayAlias}/${modelId}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(modelId) : undefined}
              testStatus={modelTestResults[modelId] as any}
              isTesting={testingModelId === modelId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Plus, Check, Copy, Trash, CheckCircle, XCircle, Cpu, Flask } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface PassthroughModelRowProps {
  modelId: string;
  fullModel: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: 'ok' | 'error' | 'testing' | null;
  isTesting?: boolean;
}

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }: PassthroughModelRowProps) {
 const borderClass = testStatus ==="ok"
 ?"border-primary/20 bg-primary/5"
 : testStatus ==="error"
 ?"border-destructive/20 bg-destructive/5"
 :"border-border/50";

 const iconClass = testStatus ==="ok"
 ?"text-primary"
 : testStatus ==="error"
 ?"text-destructive"
 :"text-muted-foreground";

 return (
 <div className={cn("flex items-center gap-3 p-1.5 rounded-none border transition-colors hover:bg-muted/50", borderClass)}>
 <div className={cn("shrink-0", iconClass)}>
 {testStatus ==="ok" ? (
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
 <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded-none leading-none truncate max-w-[180px]">{fullModel}</code>
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

 {/* Delete button */}
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

interface PassthroughModelsSectionProps {
  providerAlias: string;
  modelAliases: Record<string, string>;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onSetAlias: (modelId: string, alias: string) => Promise<void>;
  onDeleteAlias: (alias: string) => void;
}

export default function PassthroughModelsSection({ providerAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias }: PassthroughModelsSectionProps) {
 const [newModel, setNewModel] = useState("");
 const [adding, setAdding] = useState(false);

 // Filter aliases for this provider - models are persisted via alias
 const providerAliases = Object.entries(modelAliases).filter(
 ([, model]) => model.startsWith(`${providerAlias}/`)
 );

 const allModels = providerAliases.map(([alias, fullModel]) => ({
 modelId: fullModel.replace(`${providerAlias}/`,""),
 fullModel,
 alias,
 }));

 // Generate default alias from modelId (last part after /)
 const generateDefaultAlias = (modelId: string) => {
 const parts = modelId.split("/");
 return parts[parts.length - 1];
 };

 const handleAdd = async () => {
 if (!newModel.trim() || adding) return;
 const modelId = newModel.trim();
 const defaultAlias = generateDefaultAlias(modelId);
 
 // Check if alias already exists
 if (modelAliases[defaultAlias]) {
 alert(`Alias"${defaultAlias}"already exists. Please use a different model or edit existing alias.`);
 return;
 }
 
 setAdding(true);
 try {
 await onSetAlias(modelId, defaultAlias);
 setNewModel("");
 } catch (error) {
 console.log("Error adding model:", error);
 } finally {
 setAdding(false);
 }
 };

 return (
 <div className="flex flex-col gap-4">
 <p className="text-xs text-muted-foreground font-medium italic opacity-70">
 {translate("OpenRouter supports any model. Add models and create aliases for quick access.")}
 </p>

 {/* Add new model */}
 <div className="flex items-end gap-2">
 <div className="flex-1 flex flex-col gap-1.5">
 <Label
 htmlFor="new-model-input"
 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60"
 >
 {translate("Model ID (from OpenRouter)")}
 </Label>
 <Input
 id="new-model-input"
 type="text"
 value={newModel}
 onChange={(e) => setNewModel(e.target.value)}
 onKeyDown={(e) => e.key ==="Enter"&& handleAdd()}
 placeholder="anthropic/claude-3-opus"
 className="h-8 text-xs bg-muted/10 border-border/50 rounded-none shadow-none"
 />
 </div>
 <Button
 size="xs"
 variant="outline"
 onClick={handleAdd}
 disabled={!newModel.trim() || adding}
 className="gap-1.5 font-bold uppercase tracking-wider rounded-none h-8"
 >
 <Plus className="size-3" weight="bold" data-icon="inline-start" />
 {adding ? translate("Adding...") : translate("Add")}
 </Button>
 </div>

 {/* Models list */}
 {allModels.length > 0 && (
 <div className="flex flex-col gap-2 mt-1">
 {allModels.map(({ modelId, fullModel, alias }) => (
 <PassthroughModelRow
 key={fullModel}
 modelId={modelId}
 fullModel={fullModel}
 copied={copied}
 onCopy={onCopy}
 onDeleteAlias={() => onDeleteAlias(alias)}
 />
 ))}
 </div>
 )}
 </div>
 );
}

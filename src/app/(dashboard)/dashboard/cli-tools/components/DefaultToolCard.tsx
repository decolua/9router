"use client";

import React, { useState } from "react";
import { 
  Input, 
  ModelSelectModal,
  Button,
} from "@/shared/components";
import { BaseToolCard } from "./";
import { 
  Check, 
  Copy, 
  X, 
  WarningCircle as AlertCircle,
  Warning as AlertTriangle,
  Info
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface DefaultToolCardProps {
  toolId: string;
  tool: any;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: any[];
  activeProviders?: any[];
  cloudEnabled?: boolean;
  tunnelEnabled?: boolean;
}

export default function DefaultToolCard({ 
 toolId, 
 tool, 
 isExpanded, 
 onToggle, 
 baseUrl, 
 apiKeys, 
 activeProviders = [], 
 cloudEnabled = false, 
 tunnelEnabled = false 
}: DefaultToolCardProps) {
 const [copiedField, setCopiedField] = useState<string | null>(null);
 const [showModelModal, setShowModelModal] = useState(false);
 const [modelValue, setModelValue] = useState("");
 const [selectedApiKey, setSelectedApiKey] = useState(() => 
 apiKeys?.length > 0 ? apiKeys[0].key : ""
 );

 const replaceVars = (text: string) => {
 const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
 ? selectedApiKey 
 : (!cloudEnabled ? "sk_8router" : "your-api-key");
 
 const normalizedBaseUrl = baseUrl || "http://localhost:20128";
 const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1") 
 ? normalizedBaseUrl 
 : `${normalizedBaseUrl}/v1`;
 
 return text
 .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
 .replace(/\{\{apiKey\}\}/g, keyToUse)
 .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
 };

 const handleCopy = async (text: string, field: string) => {
 await navigator.clipboard.writeText(replaceVars(text));
 setCopiedField(field);
 setTimeout(() => setCopiedField(null), 2000);
 };

 const handleSelectModel = (model: any) => {
 setModelValue(model.value);
 };

 const hasActiveProviders = activeProviders.length > 0;

 const renderApiKeySelector = () => {
 return (
 <div className="flex items-center gap-2 mt-2">
 {apiKeys?.length > 0 ? (
 <>
 <select
 value={selectedApiKey}
 onChange={(e) => setSelectedApiKey(e.target.value)}
 className="flex-1 h-9 px-3 bg-muted/5 border border-border/50 rounded-none text-xs font-bold focus:outline-none focus:border-primary/50 transition-colors"
 >
 {apiKeys.map((key) => (
 <option key={key.id} value={key.key}>{key.key}</option>
 ))}
 </select>
 <Button
 variant="outline"
 size="icon"
 onClick={() => handleCopy(selectedApiKey, "apiKey")}
 className="shrink-0 h-9 w-9 rounded-none border-border/50 bg-muted/5"
 >
 {copiedField === "apiKey" ? <Check className="size-4 text-primary" weight="bold" /> : <Copy className="size-4" weight="bold" />}
 </Button>
 </>
 ) : (
 <div className="h-9 flex items-center px-3 bg-muted/10 border border-border/50 border-dashed rounded-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 w-full">
 {cloudEnabled ? translate("NO ACTIVE KEYS") : "sk_8router (INTERNAL)"}
 </div>
 )}
 </div>
 );
 };

 const renderModelSelector = () => {
 return (
 <div className="flex items-center gap-2 mt-2">
 <Input
 value={modelValue}
 onChange={(e) => setModelValue(e.target.value)}
 placeholder="provider/model-id"
 className="h-9 text-xs rounded-none border-border/50 bg-muted/5 focus-visible:ring-0 focus-visible:border-primary/50 transition-colors flex-1"
 />
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowModelModal(true)}
 disabled={!hasActiveProviders}
 className="h-9 px-3 text-[10px] font-bold uppercase tracking-widest rounded-none border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors"
 >
 {translate("Map Intelligence")}
 </Button>
 {modelValue && (
 <>
 <Button
 variant="outline"
 size="icon"
 onClick={() => handleCopy(modelValue, "model")}
 className="shrink-0 h-9 w-9 rounded-none border-border/50 bg-muted/5"
 >
 {copiedField === "model" ? <Check className="size-4 text-primary" weight="bold" /> : <Copy className="size-4" weight="bold" />}
 </Button>
 <Button
 variant="ghost"
 size="icon"
 onClick={() => setModelValue("")}
 className="h-9 w-9 rounded-none text-muted-foreground hover:text-destructive transition-colors border border-border/50 bg-muted/5"
 >
 <X className="size-4" weight="bold" />
 </Button>
 </>
 )}
 </div>
 );
 };

 const renderNotes = () => {
 if (!tool.notes || tool.notes.length === 0) return null;
 
 return (
 <div className="space-y-3 mb-6">
 {tool.notes.map((note: any, index: number) => {
 if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
 
 const isWarning = note.type === "warning";
 const isError = note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled;
 
 return (
 <div 
 key={index} 
 className={cn(
 "flex items-start gap-3 p-4 rounded-none border",
 isWarning ? "bg-muted/30 border-border/50 text-muted-foreground dark:text-muted-foreground":
 isError ? "bg-destructive/5 border-destructive/20 text-destructive":
 "bg-primary/10 border-primary/20 text-primary dark:text-primary"
 )}
 >
 {isWarning ? <AlertTriangle className="size-5 shrink-0 mt-0.5" weight="bold" /> :
 isError ? <AlertCircle className="size-5 shrink-0 mt-0.5" weight="bold" /> :
 <Info className="size-5 shrink-0 mt-0.5" weight="bold" />}
 <p className="text-[11px] font-bold uppercase tracking-wide leading-relaxed">{note.text}</p>
 </div>
 );
 })}
 </div>
 );
 };

 const canShowGuide = () => {
 if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
 if (tool.requiresCloud && !cloudEnabled) return false;
 return true;
 };

 const renderGuideSteps = () => {
 if (!tool.guideSteps) return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-30 italic py-8 text-center">Provisioning manual...</p>;

 return (
 <div className="space-y-6">
 {renderNotes()}
 {canShowGuide() && tool.guideSteps.map((item: any) => (
 <div key={item.step} className="flex items-start gap-4">
 <div 
 className="size-8 rounded-none border border-border/50 bg-muted/10 flex items-center justify-center shrink-0 text-xs font-bold tabular-nums text-foreground"
 >
 {item.step}
 </div>
 <div className="flex-1 min-w-0 space-y-2">
 <p className="font-bold text-xs uppercase tracking-widest text-foreground">{item.title}</p>
 {item.desc && <p className="text-[11px] text-muted-foreground font-medium leading-relaxed italic">{item.desc}</p>}
 {item.type === "apiKeySelector" && renderApiKeySelector()}
 {item.type === "modelSelector" && renderModelSelector()}
 {item.value && (
 <div className="flex items-center gap-2">
 <code className="flex-1 px-3 py-2 bg-muted/30 rounded-none text-[11px] font-mono border border-border/50 truncate text-foreground/70">
 {replaceVars(item.value)}
 </code>
 {item.copyable && (
 <Button
 variant="outline"
 size="icon"
 onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
 className="shrink-0 h-8 w-8 rounded-none border-border/50 bg-muted/5"
 >
 {copiedField === `${item.step}-${item.title}` ? <Check className="size-3.5 text-primary" weight="bold" /> : <Copy className="size-3.5" weight="bold" />}
 </Button>
 )}
 </div>
 )}
 </div>
 </div>
 ))}

 {canShowGuide() && tool.codeBlock && (
 <div className="space-y-2 pt-2">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {tool.codeBlock.language}
 </span>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
 className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50"
 >
 {copiedField === "codeblock" ? <Check className="mr-1.5 size-3 text-emerald-500" weight="bold" /> : <Copy className="mr-1.5 size-3" weight="bold" />}
 {copiedField === "codeblock" ? translate("Copied") : translate("Copy Manifest")}
 </Button>
 </div>
 <pre className="p-4 bg-muted/30 rounded-none border border-border/50 overflow-x-auto shadow-none">
 <code className="text-[11px] font-mono whitespace-pre text-foreground/70 leading-relaxed">
 {replaceVars(tool.codeBlock.code)}
 </code>
 </pre>
 </div>
 )}
 </div>
 );
 };

 return (
 <>
 <BaseToolCard
 tool={tool}
 isExpanded={isExpanded}
 onToggle={onToggle}
 status={null}
 onApply={null}
 onReset={null}
 hasActiveProviders={hasActiveProviders}
 >
 <div className="pt-2">
 {renderGuideSteps()}
 </div>
 </BaseToolCard>

 <ModelSelectModal
 isOpen={showModelModal}
 onClose={() => setShowModelModal(false)}
 onSelect={handleSelectModel}
 selectedModel={modelValue}
 activeProviders={activeProviders}
 title={translate("Provision Intelligence")}
 />
 </>
 );
}

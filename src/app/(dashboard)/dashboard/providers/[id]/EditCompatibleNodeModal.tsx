"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { translate } from "@/i18n/runtime";

interface Node {
  id: string;
  name?: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
}

interface EditCompatibleNodeModalProps {
  isOpen: boolean;
  node: Node | null;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
  isAnthropic?: boolean;
}

export default function EditCompatibleNodeModal({
 isOpen,
 node,
 onSave,
 onClose,
 isAnthropic,
}: EditCompatibleNodeModalProps) {
 const [formData, setFormData] = useState({
 name:"",
 prefix:"",
 apiType:"chat",
 baseUrl:"https://api.openai.com/v1",
 });
 const [saving, setSaving] = useState(false);
 const [checkKey, setCheckKey] = useState("");
 const [checkModelId, setCheckModelId] = useState("");
 const [validating, setValidating] = useState(false);
 const [validationResult, setValidationResult] = useState<string | null>(null);

 useEffect(() => {
 if (node) {
 setFormData({
 name: node.name ||"",
 prefix: node.prefix ||"",
 apiType: node.apiType ||"chat",
 baseUrl:
 node.baseUrl ||
 (isAnthropic
 ?"https://api.anthropic.com/v1"
 :"https://api.openai.com/v1"),
 });
 }
 }, [node, isAnthropic]);

 const apiTypeOptions = [
 { value:"chat", label:translate("Chat Completions")},
 { value:"responses", label:translate("Responses API")},
 ];

 const handleSubmit = async () => {
 if (
 !formData.name.trim() ||
 !formData.prefix.trim() ||
 !formData.baseUrl.trim()
 )
 return;
 setSaving(true);
 try {
 const payload: any = {
 name: formData.name,
 prefix: formData.prefix,
 baseUrl: formData.baseUrl,
 };
 if (!isAnthropic) {
 payload.apiType = formData.apiType;
 }
 await onSave(payload);
 } finally {
 setSaving(false);
 }
 };

 const handleValidate = async () => {
 setValidating(true);
 try {
 const res = await fetch("/api/provider-nodes/validate", {
 method:"POST",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({
 baseUrl: formData.baseUrl,
 apiKey: checkKey,
 type: isAnthropic ?"anthropic-compatible":"openai-compatible",
 modelId: checkModelId.trim() || undefined,
 }),
 });
 const data = await res.json();
 setValidationResult(data.valid ?"success":"failed");
 } catch {
 setValidationResult("failed");
 } finally {
 setValidating(false);
 }
 };

 if (!node) return null;

 return (
 <Dialog
 open={isOpen}
 onOpenChange={(open) => {
 if (!open) onClose();
 }}
 >
 <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg rounded-none border-border/50 shadow-none">
 <DialogHeader>
 <DialogTitle className="text-lg font-semibold tracking-tight text-foreground uppercase">
 {translate("Edit")} {isAnthropic ?"Anthropic":"OpenAI"} {translate("Compatible")}
 </DialogTitle>
 </DialogHeader>
 <div className="flex flex-col gap-4">
 <div className="flex flex-col gap-2">
 <Label htmlFor="edit-node-name" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("Name")}
 </Label>
 <Input
 id="edit-node-name"
 value={formData.name}
 onChange={(e) =>
 setFormData({ ...formData, name: e.target.value })
 }
 placeholder={`${isAnthropic ?"Anthropic":"OpenAI"} Compatible (Prod)`}
 className="rounded-none border-border/50 bg-muted/5 h-9 text-sm"
 />
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
 {translate("Required. A friendly label for this node.")}
 </p>
 </div>
 <div className="flex flex-col gap-2">
 <Label htmlFor="edit-node-prefix" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("Prefix")}
 </Label>
 <Input
 id="edit-node-prefix"
 value={formData.prefix}
 onChange={(e) =>
 setFormData({ ...formData, prefix: e.target.value })
 }
 placeholder={isAnthropic ?"ac-prod":"oc-prod"}
 className="rounded-none border-border/50 bg-muted/5 h-9 text-sm"
 />
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
 {translate("Required. Used as the provider prefix for model IDs.")}
 </p>
 </div>
 {!isAnthropic && (
 <div className="flex flex-col gap-2">
 <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("API Type")}
 </Label>
 <Select
 value={formData.apiType}
 onValueChange={(v) =>
 setFormData({ ...formData, apiType: v as string })
 }
 >
 <SelectTrigger className="w-full rounded-none border-border/50 bg-muted/5 h-9 text-xs shadow-none">
 <SelectValue />
 </SelectTrigger>
 <SelectContent className="rounded-none shadow-none border-border/50">
 {apiTypeOptions.map((opt) => (
 <SelectItem key={opt.value} value={opt.value} className="rounded-none text-xs font-medium">
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 )}
 <div className="flex flex-col gap-2">
 <Label htmlFor="edit-node-base" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("Base URL")}
 </Label>
 <Input
 id="edit-node-base"
 value={formData.baseUrl}
 onChange={(e) =>
 setFormData({ ...formData, baseUrl: e.target.value })
 }
 placeholder={
 isAnthropic
 ?"https://api.anthropic.com/v1"
 :"https://api.openai.com/v1"
 }
 className="rounded-none border-border/50 bg-muted/5 h-9 text-sm tabular-nums"
 />
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
 {translate("Use the base URL (ending in /v1) for your")} {" "}
 {isAnthropic ?"Anthropic":"OpenAI"}-{translate("compatible API.")}
 </p>
 </div>
 <div className="flex gap-2">
 <div className="min-w-0 flex-1 flex flex-col gap-2">
 <Label htmlFor="edit-node-check-key" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("API Key (for Check)")}
 </Label>
 <Input
 id="edit-node-check-key"
 type="password"
 value={checkKey}
 onChange={(e) => setCheckKey(e.target.value)}
 className="rounded-none border-border/50 bg-muted/5 h-9 text-sm"
 />
 </div>
 <div className="flex items-end">
 <Button
 type="button"
 variant="secondary"
 onClick={handleValidate}
 disabled={!checkKey || validating || !formData.baseUrl.trim()}
 className="h-9 rounded-none px-3 text-xs font-bold uppercase tracking-wider"
 >
 {validating ? <Spinner className="size-3.5" /> : translate("Check")}
 </Button>
 </div>
 </div>
 <div className="flex flex-col gap-2">
 <Label htmlFor="edit-node-model" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
 {translate("Model ID (optional)")}
 </Label>
 <Input
 id="edit-node-model"
 value={checkModelId}
 onChange={(e) => setCheckModelId(e.target.value)}
 placeholder="e.g. my-model-id"
 className="rounded-none border-border/50 bg-muted/5 h-9 text-sm"
 />
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
 {translate("If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead.")}
 </p>
 </div>
 {validationResult &&
 (validationResult ==="success"? (
 <Badge className="border-primary/20 bg-primary/10 text-primary dark:text-primary rounded-none h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider border-none">
 {translate("Valid")}
 </Badge>
 ) : (
 <Badge variant="destructive" className="rounded-none h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider border-none">
 {translate("Invalid")}
 </Badge>
 ))}
 <div className="flex gap-2 pt-2">
 <Button
 type="button"
 className="flex-1 rounded-none h-9 text-xs font-bold uppercase tracking-wider"
 onClick={handleSubmit}
 disabled={
 !formData.name.trim() ||
 !formData.prefix.trim() ||
 !formData.baseUrl.trim() ||
 saving
 }
 >
 {saving ? <Spinner className="size-3.5" /> : translate("Save")}
 </Button>
 <Button
 type="button"
 variant="secondary"
 className="flex-1 rounded-none h-9 text-xs font-bold uppercase tracking-wider"
 onClick={onClose}
 >
 {translate("Cancel")}
 </Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}

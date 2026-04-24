"use client";

import React, { useState, useEffect } from "react";
import { Flask, CheckCircle, XCircle } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";

interface AddCustomModelModalProps {
  isOpen: boolean;
  providerAlias: string;
  providerDisplayAlias: string;
  onSave: (modelId: string) => Promise<void>;
  onClose: () => void;
}

export default function AddCustomModelModal({
 isOpen,
 providerAlias,
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 providerDisplayAlias,
 onSave,
 onClose,
}: AddCustomModelModalProps) {
 const [modelId, setModelId] = useState("");
 const [testStatus, setTestStatus] = useState<string | null>(null);
 const [testError, setTestError] = useState("");
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 if (isOpen) {
 setModelId("");
 setTestStatus(null);
 setTestError("");
 }
 }, [isOpen]);

 const handleTest = async () => {
 if (!modelId.trim()) return;
 setTestStatus("testing");
 setTestError("");
 try {
 const res = await fetch("/api/models/test", {
 method:"POST",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ model: `${providerAlias}/${modelId.trim()}` }),
 });
 const data = await res.json();
 setTestStatus(data.ok ?"ok":"error");
 setTestError(data.error ||"");
 } catch (err: any) {
 setTestStatus("error");
 setTestError(err.message);
 }
 };

 const handleSave = async () => {
 if (!modelId.trim() || saving) return;
 setSaving(true);
 try {
 await onSave(modelId.trim());
 } finally {
 setSaving(false);
 }
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key ==="Enter") handleTest();
 };

 return (
 <Dialog
 open={isOpen}
 onOpenChange={(open) => {
 if (!open) onClose();
 }}
 >
 <DialogContent className="sm:max-w-md rounded-none border-border/50 shadow-none">
 <DialogHeader>
 <DialogTitle className="text-lg font-semibold tracking-tight">{translate("Add Custom Model")}</DialogTitle>
 </DialogHeader>
 <div className="flex flex-col gap-4">
 <div className="flex flex-col gap-2">
 <Label htmlFor="custom-model-id" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
 {translate("Model ID")}
 </Label>
 <div className="flex gap-2">
 <Input
 id="custom-model-id"
 type="text"
 value={modelId}
 onChange={(e) => {
 setModelId(e.target.value);
 setTestStatus(null);
 setTestError("");
 }}
 onKeyDown={handleKeyDown}
 placeholder="e.g. claude-opus-4-5"
 className="flex-1 rounded-none border-border/50 bg-muted/5 h-9 text-sm"
 autoFocus
 />
 <Button
 type="button"
 variant="secondary"
 onClick={handleTest}
 disabled={!modelId.trim() || testStatus ==="testing"}
 className="shrink-0 h-9 rounded-none px-3 text-xs font-bold uppercase tracking-wider gap-1.5"
 >
 {testStatus ==="testing"? (
 <Spinner className="size-4 animate-spin" />
 ) : (
 <Flask className="size-4" weight="bold" data-icon="inline-start" />
 )}
 {testStatus ==="testing" ? translate("Checking") : translate("Test")}
 </Button>
 </div>
 <p className="text-[10px] text-muted-foreground font-medium italic opacity-70">
 {translate("Sent to provider as")}:{""}
 <code className="rounded-none bg-muted px-1 font-mono text-[10px] text-foreground">
 {modelId.trim() ||"model-id"}
 </code>
 </p>
 </div>

 {testStatus ==="ok"&& (
 <div className="flex items-center gap-2 text-xs font-medium text-primary">
 <CheckCircle className="size-4" weight="bold" />
 {translate("Model is reachable")}
 </div>
 )}
 {testStatus ==="error"&& (
 <div className="flex items-start gap-2 text-xs font-medium text-destructive">
 <XCircle className="size-4 shrink-0" weight="bold" />
 <span>{testError || translate("Model not reachable")}</span>
 </div>
 )}

 <div className="flex gap-2 pt-1">
 <Button
 type="button"
 variant="outline"
 size="sm"
 className="flex-1 rounded-none h-9 text-[10px] font-bold uppercase tracking-widest"
 onClick={onClose}
 >
 {translate("Cancel")}
 </Button>
 <Button
 type="button"
 size="sm"
 className="flex-1 rounded-none h-9 text-[10px] font-bold uppercase tracking-widest"
 onClick={handleSave}
 disabled={!modelId.trim() || saving}
 >
 {saving ? <Spinner className="size-3.5" /> : translate("Add Model")}
 </Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}

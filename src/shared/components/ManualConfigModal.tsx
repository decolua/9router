"use client";

import React, { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check, FileCode } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface Config {
  filename: string;
  content: string;
}

interface ManualConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  configs?: Config[];
}

export default function ManualConfigModal({ isOpen, onClose, title = translate("Manual Configuration"), configs = [] }: ManualConfigModalProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) { console.log(err); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl border-border/50 shadow-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
             <FileCode className="size-5 text-primary" />
             {title}
          </DialogTitle>
          <DialogDescription className="text-xs font-medium">{translate("Manual system configuration for infrastructure integration.")}</DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] pr-4">
           <div className="space-y-6 py-2">
             {configs.map((config, index) => (
               <div key={index} className="space-y-2">
                 <div className="flex items-center justify-between px-1">
                   <span className="text-xs text-muted-foreground">{config.filename}</span>
                   <Button variant="ghost" size="sm" className="h-7 text-xs font-medium" onClick={() => copyToClipboard(config.content, index)}>
                      {copiedIndex === index ? <Check className="size-3 mr-1.5 text-emerald-500" /> : <Copy className="size-3 mr-1.5" />}
                      {copiedIndex === index ? translate("Copied") : translate("Copy Source")}
                   </Button>
                 </div>
                 <pre className="p-4 rounded-xl bg-muted/40 border border-border font-mono text-[11px] leading-relaxed text-foreground/80 overflow-auto whitespace-pre-wrap break-all shadow-none">
                   {config.content}
                 </pre>
               </div>
             ))}
           </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

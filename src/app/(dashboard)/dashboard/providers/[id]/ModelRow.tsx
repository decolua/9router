"use client";

import React from "react";
import { 
  CheckCircle, 
  XCircle, 
  Cpu, 
  Flask, 
  Check, 
  Copy, 
  X 
} from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface Model {
  id: string;
  name?: string;
  isFree?: boolean;
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
}

export default function ModelRow({
  model,
  fullModel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onTest,
  isTesting,
}: ModelRowProps) {
  const borderClass =
    testStatus === "ok"
      ? "border-primary/20 bg-primary/5"
      : testStatus === "error"
      ? "border-destructive/40 bg-destructive/5"
      : "border-border/50";

  const iconClass =
    testStatus === "ok"
      ? "text-primary"
      : testStatus === "error"
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group rounded-none border px-2 py-1.5 transition-colors",
        borderClass,
        "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn("shrink-0", iconClass)}>
          {testStatus === "ok" ? (
            <CheckCircle className="size-3.5" weight="bold" />
          ) : testStatus === "error" ? (
            <XCircle className="size-3.5" weight="bold" />
          ) : (
            <Cpu className="size-3.5" weight="bold" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <code className="rounded-none bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground w-fit max-w-full truncate">
            {fullModel}
          </code>
          {model.name && (
            <span className="pl-1 text-[10px] font-bold text-muted-foreground/60 truncate uppercase tracking-widest opacity-70">
              {model.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onTest && (
            <div className="group/btn relative">
              <button
                type="button"
                onClick={onTest}
                disabled={isTesting}
                className={cn(
                  "rounded-none p-0.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
                  isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                {isTesting ? (
                  <Spinner className="size-3.5 animate-spin" />
                ) : (
                  <Flask className="size-3.5" weight="bold" />
                )}
              </button>
              <span className="pointer-events-none absolute top-6 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded-none border border-border/50 shadow-none opacity-0 transition-opacity group-hover/btn:opacity-100 z-10">
                {isTesting ? translate("Testing...") : translate("Test")}
              </span>
            </div>
          )}

          <div className="group/btn relative">
            <button
              type="button"
              onClick={() => onCopy(fullModel, `model-${model.id}`)}
              className="rounded-none p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {copied === `model-${model.id}` ? (
                <Check className="size-3.5 text-primary" weight="bold" />
              ) : (
                <Copy className="size-3.5" weight="bold" />
              )}
            </button>
            <span className="pointer-events-none absolute top-6 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold uppercase tracking-tighter bg-popover text-popover-foreground px-1.5 py-0.5 rounded-none border border-border/50 shadow-none opacity-0 transition-opacity group-hover/btn:opacity-100 z-10">
              {copied === `model-${model.id}` ? translate("Copied!") : translate("Copy")}
            </span>
          </div>

          {isFree && (
            <span className="h-4 px-1.5 bg-primary/10 text-primary border-none rounded-none text-[9px] font-black uppercase tracking-widest flex items-center justify-center">FREE</span>
          )}

          {isCustom && (
            <button
              type="button"
              onClick={onDeleteAlias}
              className="rounded-none p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              title={translate("Remove custom model")}
            >
              <X className="size-3.5" weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

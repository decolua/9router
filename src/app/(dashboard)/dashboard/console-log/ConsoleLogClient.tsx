"use client";

import React, { useState, useEffect, useRef } from "react";
import { Desktop, Trash } from "@phosphor-icons/react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS: Record<string, string> = {
  LOG: "text-primary",
  INFO: "text-primary",
  WARN: "text-muted-foreground",
  ERROR: "text-destructive",
  DEBUG: "text-primary",
};

function colorLine(line: string) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[0]?.replace(/[\[\]]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag || ""] || "text-primary";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase tracking-tight">
            <Desktop className="size-4" weight="bold"/>
            Hệ thống
          </div>
          <h1 className="text-3xl font-medium tracking-tight uppercase">Console Log</h1>
          <p className="text-sm text-muted-foreground font-medium italic opacity-70">
            Live server infrastructure telemetry stream.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleClear} className="h-8 text-[10px] font-bold uppercase tracking-widest px-3 rounded-none border-border/50 bg-background">
            <Trash className="size-3.5 mr-2" weight="bold"/>
            Clear Stream
          </Button>
        </div>
      </header>

      <Card className="border-border/50 overflow-hidden bg-black shadow-none rounded-none">
        <div
          ref={logRef}
          className="p-6 text-[11px] font-mono h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar bg-black/40 shadow-inner"
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-10 grayscale gap-4">
              <Desktop className="size-16" weight="bold" />
              <span className="text-xs font-black uppercase tracking-[0.3em]">Awaiting telemetry...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all border-l-2 border-primary/20 pl-3 py-0.5 hover:bg-white/5 transition-colors">{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

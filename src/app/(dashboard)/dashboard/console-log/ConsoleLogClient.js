"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, Button, PageShell } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { stripEmoji } from "@/shared/utils/plainText";

function colorLine(line, index) {
  let levelColor = "text-text-main";
  let tagBg = "";
  if (line.includes("[ERROR]") || line.includes("✗") || line.includes("Error:") || line.includes("FAILED")) {
    levelColor = "text-rose-400";
    tagBg = "bg-rose-500/10";
  } else if (line.includes("[WARN]") || line.includes("⚠️")) {
    levelColor = "text-amber-400";
    tagBg = "bg-amber-500/10";
  } else if (line.includes("[INFO]") || line.includes("▶") || line.includes("ℹ️")) {
    levelColor = "text-cyan-400";
    tagBg = "bg-cyan-500/10";
  } else if (line.includes("[DEBUG]") || line.includes("🐛")) {
    levelColor = "text-text-muted";
  } else if (line.includes("✓") || line.includes("done") || line.includes("SUCCESS")) {
    levelColor = "text-emerald-400";
    tagBg = "bg-emerald-500/10";
  }

  return (
    <div className={`flex items-start gap-2.5 px-2 py-0.5 hover:bg-surface-2/60 rounded font-mono text-xs leading-relaxed transition-colors ${tagBg}`}>
      <span className="text-text-muted/50 select-none shrink-0 w-9 text-right font-mono text-[11px] pt-0.5">
        {index + 1}
      </span>
      <span className={`flex-1 break-all whitespace-pre-wrap ${levelColor}`}>
        {stripEmoji(line)}
      </span>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("all"); // "all", "report_problem", "warn", "info"
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    if (!window.confirm("Clear all console logs?")) return;
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const handleCopy = () => {
    const text = filteredLogs.join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init") {
          setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "line") {
          setLogs((prev) => {
            const next = [...prev, msg.line];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "lines") {
          setLogs((prev) => {
            const next = [...prev, ...msg.lines];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "clear") {
          setLogs([]);
        }
      } catch {
        /* fail open */
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!autoScroll || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const filteredLogs = useMemo(() => {
    return logs.filter((line) => {
      if (levelFilter === "report_problem" && !(line.includes("[ERROR]") || line.includes("✗") || line.includes("Error:") || line.includes("FAILED"))) {
        return false;
      }
      if (levelFilter === "warn" && !(line.includes("[WARN]") || line.includes("⚠️"))) {
        return false;
      }
      if (levelFilter === "info" && !(line.includes("[INFO]") || line.includes("▶") || line.includes("ℹ️"))) {
        return false;
      }
      if (filter && !line.toLowerCase().includes(filter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [logs, filter, levelFilter]);

  return (
    <PageShell width="full" className="min-w-0">
      <Card className="flex flex-col overflow-hidden rounded-2xl border-border bg-surface shadow-sm">
        {/* Sleek Terminal Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-4 border-b border-border bg-surface-2/40 sm:px-5">
          <div className="flex items-center gap-3">
            {/* Terminal Window Dots */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="size-3 rounded-full bg-rose-500/80 inline-block" />
              <span className="size-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="size-3 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            <div className="h-4 w-px bg-border" />

            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">code</span>
              <span className="text-sm font-semibold text-text-main">Live Terminal Console</span>
              <span className="text-xs text-text-muted font-mono">({filteredLogs.length} / {logs.length} lines)</span>
            </div>
          </div>

          {/* Action buttons & Connection state */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono font-medium ${
                connected
                  ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
              }`}
            >
              <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
              {connected ? "Live Stream" : "Disconnected"}
            </span>

            <Button
              size="sm"
              variant={autoScroll ? "primary" : "outline"}
              icon={autoScroll ? "south" : "pause_circle"}
              onClick={() => setAutoScroll(!autoScroll)}
              title={autoScroll ? "Auto-scroll is ON" : "Auto-scroll is PAUSED"}
            >
              {autoScroll ? "Auto-scroll" : "Paused"}
            </Button>

            {logs.length > 0 && (
              <>
                <Button size="sm" variant="outline" icon={copied ? "task_alt" : "file_copy"} onClick={handleCopy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" variant="danger" icon="delete_sweep" onClick={handleClear}>
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-surface text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="material-symbols-outlined text-[16px] text-text-muted">manage_search</span>
            <input
              type="text"
              placeholder="Search console logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-transparent text-text-main placeholder-text-muted/60 focus:outline-none font-mono text-xs"
            />
            {filter && (
              <button onClick={() => setFilter("")} className="text-text-muted hover:text-text-main">
                <span className="material-symbols-outlined text-[14px]">cancel</span>
              </button>
            )}
          </div>

          {/* Level Filter Chips */}
          <div className="flex items-center gap-1 shrink-0 font-mono text-[11px]">
            {[
              { id: "all", label: "ALL" },
              { id: "report_problem", label: "ERRORS" },
              { id: "warn", label: "WARNS" },
              { id: "info", label: "INFO" },
            ].map((lvl) => (
              <button
                key={lvl.id}
                onClick={() => setLevelFilter(lvl.id)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  levelFilter === lvl.id
                    ? "bg-primary text-white font-semibold"
                    : "text-text-muted hover:text-text-main hover:bg-surface-2"
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={logRef}
          className="p-3 sm:p-4 font-mono text-xs h-[calc(100dvh-290px)] md:h-[calc(100dvh-250px)] overflow-y-auto bg-surface-2 text-text-main select-text custom-scrollbar border border-border-subtle rounded-b-2xl"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-muted/60 gap-2">
              <span className="material-symbols-outlined text-3xl">code</span>
              <span>{logs.length === 0 ? "Waiting for console output..." : "No log lines match current filter."}</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredLogs.map((line, i) => (
                <div key={i}>{colorLine(line, i)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </PageShell>
  );
}

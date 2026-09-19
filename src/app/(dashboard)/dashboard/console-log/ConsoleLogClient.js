"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

function colorLine(line, index) {
  // Detect log level from tags like [LOG], [INFO], [WARN], [ERROR], [DEBUG]
  let levelColor = "text-gray-300";
  if (line.includes("[ERROR]") || line.includes("✗")) levelColor = "text-red-400";
  else if (line.includes("[WARN]")) levelColor = "text-yellow-400";
  else if (line.includes("[INFO]") || line.includes("▶")) levelColor = "text-blue-400";
  else if (line.includes("[DEBUG]")) levelColor = "text-purple-400";
  else if (line.includes("✓") || line.includes("done")) levelColor = "text-green-400";

  return (
    <div className="flex gap-2 hover:bg-white/5 px-1 rounded">
      <span className="text-gray-600 select-none shrink-0 w-8 text-right">{index + 1}</span>
      <span className={levelColor}>{line}</span>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
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
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">receipt_long</span>
            <span className="text-sm font-medium text-text-main">Console Logs</span>
            <span className="text-xs text-text-muted">({logs.length} lines)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${connected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
              {connected ? "Connected" : "Disconnected"}
            </span>
            <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line, i)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

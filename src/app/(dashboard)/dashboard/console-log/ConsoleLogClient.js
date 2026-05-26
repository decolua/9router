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

function colorLine(line) {
  let color = "#cbd5e1"; // default fallback (slate-300 / light gray)

  if (
    line.includes("❌") ||
    line.includes("💥") ||
    line.includes("[ERROR]") ||
    line.includes("ERROR")
  ) {
    color = "#f87171"; // red
  } else if (
    line.includes("⚠️") ||
    line.includes("[WARN]") ||
    line.includes("WARN")
  ) {
    color = "#fbbf24"; // yellow
  } else if (
    line.includes("📥") ||
    line.includes("[REQUEST]") ||
    line.includes("[ProxyFetch]")
  ) {
    color = "#22d3ee"; // cyan
  } else if (
    line.includes("📤") ||
    line.includes("ℹ️") ||
    line.includes("[INFO]") ||
    line.includes("[COMBO]")
  ) {
    color = "#4ade80"; // green
  } else if (
    line.includes("🔍") ||
    line.includes("[AUTH]") ||
    line.includes("[ROUTING]")
  ) {
    color = "#38bdf8"; // sky blue
  } else if (line.includes("🌊") || line.includes("[STREAM]")) {
    color = "#e879f9"; // fuchsia
  } else if (
    line.includes("📊") ||
    line.includes("📈") ||
    line.includes("[USAGE]") ||
    line.includes("[STREAM USAGE]")
  ) {
    color = "#f472b6"; // pink
  } else if (line.includes("[PENDING]")) {
    color = "#818cf8"; // indigo
  } else if (line.includes("[DB]") || line.includes("[InitApp]")) {
    color = "#94a3b8"; // slate
  }

  return <span style={{ color }}>{line}</span>;
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
          return next.length > CONSOLE_LOG_CONFIG.maxLines
            ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
            : next;
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
        <div className="flex items-center justify-end px-4 pt-3 pb-2">
          <Button
            size="sm"
            variant="outline"
            icon="delete"
            onClick={handleClear}
          >
            Clear
          </Button>
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
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

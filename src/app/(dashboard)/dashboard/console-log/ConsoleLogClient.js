"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { cn } from "@/shared/utils/cn";
import {
  LOG_LEVELS,
  parseLogEntry,
  countByLevel,
  collectTags,
  matchesLogFilters,
} from "@/shared/utils/consoleLogFormat";

const LEVEL_STYLES = {
  ERROR: { text: "text-danger" },
  WARN: { text: "text-warning" },
  INFO: { text: "text-info" },
  DEBUG: { text: "text-text-muted" },
};

const LEVEL_FILTERS = ["ALL", ...LOG_LEVELS];

/** Identity of a captured entry: the capture sequence, or the raw text. */
function entryKey(entry) {
  if (typeof entry === "string") return entry;
  return entry?.seq !== undefined ? `s${entry.seq}` : `t${entry.t ?? ""}:${entry?.text ?? ""}`;
}

/** Colorize one " · "-separated segment of a request/response summary. */
function Segment({ text }) {
  if (/^POST\b/.test(text)) return <span className="text-text-main font-semibold">{text}</span>;
  if (/^FMT:/.test(text)) return <span className="text-info">{text}</span>;
  if (text === "STREAM" || text === "JSON") return <span className="text-brand-500">{text}</span>;
  if (/^(ACC|THINK)/.test(text)) return <span className="text-warning">{text}</span>;
  if (/^DONE\b/.test(text)) return <span className="text-success">{text}</span>;
  if (/^(IN|OUT|CACHE)/.test(text)) return <span className="text-text-muted">{text}</span>;
  return <span className="text-text-muted">{text}</span>;
}

function LogRow({ row, wrap }) {
  const style = LEVEL_STYLES[row.level] || LEVEL_STYLES.INFO;
  const isError = row.level === "ERROR";
  const segments = row.body.split(" · ");

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[6px] px-2 py-[3px]",
        isError && "bg-danger/10 border-l-2 border-danger",
        wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
      )}
    >
      <span className="shrink-0 text-text-subtle tabular-nums">{row.time || "--:--:--"}</span>
      <span className={cn("shrink-0 w-11 font-semibold", style.text)}>{row.level}</span>
      <span className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed">
        {row.kind === "request" || row.kind === "done"
          ? segments.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span className="text-text-subtle"> · </span>}
                <Segment text={seg} />
              </span>
            ))
          : <span className={isError ? "text-danger" : "text-text-main"}>{row.body}</span>}
      </span>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState([]);
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("ALL");
  const [tag, setTag] = useState("ALL");
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);
  const pausedRef = useRef(false);

  const appendEntries = (incoming) => {
    if (!incoming?.length) return;
    setEntries((prev) => {
      const next = [...prev, ...incoming];
      return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
    });
  };

  // Merge a replayed buffer snapshot without duplicating already-seen lines.
  // Entries carry a monotonic `seq`; lines without one fall back to text identity.
  const mergeEntries = (incoming) => {
    if (!incoming?.length) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => entryKey(e)));
      const fresh = incoming.filter((e) => !seen.has(entryKey(e)));
      if (!fresh.length) return prev;
      const next = [...prev, ...fresh];
      return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
    });
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        // The stream replays the whole buffer on (re)connect, so merge by seq
        // instead of appending — otherwise every reconnect duplicates rows.
        mergeEntries(msg.logs);
      } else if (msg.type === "line") {
        if (pausedRef.current) setPending((prev) => [...prev, msg.line]);
        else appendEntries([msg.line]);
      } else if (msg.type === "lines") {
        if (pausedRef.current) setPending((prev) => [...prev, ...msg.lines]);
        else appendEntries(msg.lines);
      } else if (msg.type === "clear") {
        setEntries([]);
        setPending([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  const togglePause = () => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (!next && pending.length) {
        appendEntries(pending);
        setPending([]);
      }
      return next;
    });
  };

  // Rows are derived from the raw entries; parsing is pure and memoized.
  const rows = useMemo(() => entries.map((entry, i) => parseLogEntry(entry, i)), [entries]);
  const levelCounts = useMemo(() => countByLevel(rows), [rows]);
  const tags = useMemo(() => collectTags(rows), [rows]);

  const visible = useMemo(
    () => rows.filter((row) => matchesLogFilters(row, { query, level, tag })),
    [rows, query, level, tag]
  );

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visible]);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const visibleText = () => visible.map((row) => row.raw).join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(visibleText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy console logs:", err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([visibleText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `console-log-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="">
      <Card padding="none" className="overflow-hidden">
        {/* Controls */}
        <div className="flex flex-col gap-3 border-b border-border-subtle p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
                search
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search model, provider, account…"
                aria-label="Search console logs"
                className="w-full rounded-[10px] border border-transparent bg-surface-2 py-1.5 pl-10 pr-9 text-sm text-text-main transition-all duration-150 ease-out placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted transition-colors hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>

            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label="Filter by tag"
              className="rounded-[10px] border border-transparent bg-surface-2 px-3 py-1.5 text-sm text-text-main focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <option value="ALL">All tags ({rows.length})</option>
              {tags.map(({ tag: t, count }) => (
                <option key={t} value={t}>
                  {t} ({count})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 p-1">
              {LEVEL_FILTERS.map((lvl) => {
                const count = lvl === "ALL" ? rows.length : levelCounts[lvl] || 0;
                const active = level === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevel(lvl)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-medium transition-all",
                      active ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
                    )}
                  >
                    {lvl}
                    <span className={cn("tabular-nums", active ? "text-text-muted" : "text-text-subtle")}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className={cn("flex items-center gap-1.5 text-[11px]", connected ? "text-success" : "text-text-muted")}>
                <span className={cn("size-1.5 rounded-full", connected ? "bg-success" : "bg-text-subtle")} />
                {connected ? "Live" : "Offline"}
              </span>

              <Button
                size="sm"
                variant={paused ? "primary" : "outline"}
                icon={paused ? "play_arrow" : "pause"}
                onClick={togglePause}
              >
                {paused ? `Resume${pending.length ? ` (${pending.length})` : ""}` : "Pause"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                icon="wrap_text"
                onClick={() => setWrap((w) => !w)}
                aria-pressed={wrap}
              >
                Wrap
              </Button>

              <Button size="sm" variant="outline" icon="content_copy" onClick={handleCopy}>
                {copied ? "Copied" : "Copy visible"}
              </Button>

              <Button size="sm" variant="outline" icon="download" onClick={handleDownload}>
                .log
              </Button>

              <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
                Clear
              </Button>
            </div>
          </div>

          {paused && pending.length > 0 && (
            <div className="flex items-center gap-2 rounded-[8px] bg-warning/10 px-3 py-1.5 text-xs text-warning">
              <span className="material-symbols-outlined text-[16px]">pause_circle</span>
              Paused — {pending.length} new line{pending.length === 1 ? "" : "s"} buffered. Resume to append them.
            </div>
          )}
        </div>

        {/* Log rows */}
        <div ref={logRef} className="bg-bg p-3 font-mono text-xs h-[calc(100vh-300px)] overflow-y-auto">
          {visible.length === 0 ? (
            <span className="text-text-muted">
              {rows.length === 0 ? "No console logs yet." : "No logs match the current filters."}
            </span>
          ) : (
            <div className="space-y-0.5">
              {visible.map((row) => (
                <LogRow key={row.id} row={row} wrap={wrap} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

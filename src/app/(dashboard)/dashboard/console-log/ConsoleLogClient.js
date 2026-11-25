"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { filterConsole } from "@/shared/utils/consoleFilter";

const colors = { error: "text-red-400", warn: "text-yellow-400", info: "text-green-400", debug: "text-sky-400" };
const input = "bg-surface border border-border rounded px-2 py-1";
const max = CONSOLE_LOG_CONFIG.maxLines;
export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]), [frozen, freeze] = useState(null);
  const [query, setQuery] = useState(""), [level, setLevel] = useState("");
  const [requestId, setRequestId] = useState(""), [limit, setLimit] = useState(max);
  const logRef = useRef(null), cleared = useRef(false);

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");
    es.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init" && !cleared.current) setLogs(msg.logs.slice(-max));
      if (msg.type === "line" || msg.type === "lines")
        setLogs(prev => prev.concat(msg.type === "line" ? [msg.line] : msg.lines).slice(-max));
      if (msg.type === "clear") setLogs([]);
    };
    return () => es.close();
  }, []);
  const view = frozen ?? logs;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [view]);
  return <Card>
    <search className="flex flex-wrap items-end gap-3 p-3 text-sm">
      <label className="grid">Search logs<input className={input} type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="grid">Request ID<input className={input} value={requestId} onChange={e => setRequestId(e.target.value)} /></label>
      <label className="grid">Log level<select className={input} value={level} onChange={e => setLevel(e.target.value)}>
        <option value="">All levels</option>{Object.keys(colors).map(l => <option key={l} value={l}>{l}</option>)}
      </select></label>
      <label className="grid">Row limit<select className={input} value={limit} onChange={e => setLimit(Number(e.target.value))}>
        {[25, 50, 100, max].map(n => <option key={n}>{n}</option>)}</select></label>
      <Button size="sm" variant="outline" onClick={() => freeze(frozen ? null : logs)}>{frozen ? "Resume" : "Pause"}</Button>
      <Button size="sm" variant="outline" onClick={() => { cleared.current = true; setLogs([]); if (frozen) freeze([]); }}>Clear view</Button>
    </search>
    <div ref={logRef} className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-240px)] overflow-auto">
      <LogLines rows={filterConsole(view, { query, level, requestId, limit })} />
    </div>
  </Card>;
}

function LogLines({ rows }) {
  if (!rows.length) return <span className="text-gray-400">No matching log lines</span>;
  return rows.map(({ line, level, requestId }, i) => <div key={i} className={colors[level]} data-i18n-skip>
    {line}{requestId && <> · <Link className="underline" href={`/dashboard/usage?tab=details&requestId=${encodeURIComponent(requestId)}`}>{requestId}</Link></>}
  </div>);
}

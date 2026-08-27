"use client";

import { sanitizePlaygroundData } from "../lib/sanitize";

function visibleInspectorData(data) {
  const request = data?.request || {};
  const response = data?.response || {};
  const metrics = data?.metrics || {};
  return sanitizePlaygroundData({
    model: request.model,
    request: {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stop: request.stop,
    },
    status: response.status,
    output: response.output,
    metrics: {
      durationMs: metrics.durationMs,
      ttftMs: metrics.ttftMs,
      usage: metrics.usage,
      terminalState: metrics.terminalState,
    },
  });
}

export default function PlaygroundInspector({ data }) {
  const safe = visibleInspectorData(data);
  const usage = safe.metrics?.usage;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-bg-alt overflow-y-auto p-4 space-y-4" data-testid="playground-inspector">
      <h2 className="text-sm font-semibold text-text-main">Inspector</h2>
      <dl className="space-y-2 text-xs text-text-muted">
        <div><dt className="font-medium text-text-main">Model</dt><dd>{safe.model || "Unavailable"}</dd></div>
        <div><dt className="font-medium text-text-main">Status</dt><dd>{safe.status == null ? "Unavailable" : `HTTP ${safe.status}`}</dd></div>
        <div><dt className="font-medium text-text-main">Duration</dt><dd>{safe.metrics?.durationMs == null ? "Unavailable" : `${safe.metrics.durationMs}ms`}</dd></div>
        <div><dt className="font-medium text-text-main">TTFT</dt><dd>{safe.metrics?.ttftMs == null ? "Unavailable" : `${safe.metrics.ttftMs}ms`}</dd></div>
        <div><dt className="font-medium text-text-main">Usage</dt><dd>{usage?.totalTokens == null ? "Unavailable" : usage.totalTokens}</dd></div>
        <div><dt className="font-medium text-text-main">State</dt><dd>{safe.metrics?.terminalState || "Unavailable"}</dd></div>
      </dl>
      <section>
        <h3 className="text-xs font-medium text-text-main mb-1">Request</h3>
        <pre className="whitespace-pre-wrap break-words text-xs text-text-muted">{JSON.stringify(safe.request, null, 2)}</pre>
      </section>
      <section>
        <h3 className="text-xs font-medium text-text-main mb-1">Output</h3>
        <pre className="whitespace-pre-wrap break-words text-xs text-text-main">{safe.output || ""}</pre>
      </section>
    </aside>
  );
}

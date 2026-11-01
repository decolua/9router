"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Card, Button, Input, ModelSelectModal, CardSkeleton } from "@/shared/components";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getPricingForModel, calculateCostFromTokens, formatCost } from "open-sse/providers/pricing.js";
import { describeEmptyResponse } from "@/shared/utils/modelResponse";
import { streamChatCompletion } from "@/shared/utils/chatStream";

const MAX_MODELS = 4;
const MIN_MODELS = 1;

const ALIAS_TO_PROVIDER_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
);

function splitModel(value) {
  const str = String(value || "").trim();
  if (!str.includes("/")) return { provider: null, model: str };
  const firstSlash = str.indexOf("/");
  const prefix = str.slice(0, firstSlash);
  return { provider: ALIAS_TO_PROVIDER_ID[prefix] || prefix, model: str.slice(firstSlash + 1) };
}

function estimateCost(modelName, usage, studioTargets) {
  const { provider, model } = splitModel(studioTargets?.[modelName] || modelName);
  const pricing = getPricingForModel(provider, model);
  if (!pricing) return null;
  return calculateCostFromTokens(usage || {}, pricing);
}

// Battle costs are usually sub-cent, so two decimals would render every row as $0.00.
function showCost(cost) {
  if (cost === null || cost === undefined || Number.isNaN(cost)) return "n/a";
  if (cost >= 0.01) return formatCost(cost);
  if (cost < 0.0001) return `$${cost.toExponential(1)}`;
  return `$${cost.toFixed(4)}`;
}

function emptyResult() {
  return { loading: false, data: null };
}

// Every finished card reads the same fields, so a run that never got there has to
// answer for them instead of leaving the renderers with holes.
function slotData() {
  return {
    ok: false,
    kind: "empty",
    content: "",
    thinking: "",
    hint: "",
    detail: "",
    status: "",
    source: "",
    cooldown: "",
    ms: null,
    ttftMs: null,
    usage: null,
    cost: null,
    chars: 0,
    stopped: false,
    stoppedNote: "",
  };
}

// A stopped card keeps its partial text, so it needs a sentence of its own.
function stoppedNote(data) {
  const lines = String(data?.content || "")
    .split("\n")
    .filter((line) => line.trim()).length;
  if (lines) return `Stopped after ${lines} ${lines === 1 ? "line" : "lines"} of output.`;
  if (String(data?.thinking || "").trim()) return "Stopped while the model was still reasoning.";
  return "Stopped before any output arrived.";
}

/**
 * The one immutable update path for a contender card. Every callback of a running
 * stream goes through here carrying the battle `run` it belongs to, so concurrent
 * slots never overwrite each other and chunks from a stopped or superseded run are
 * dropped rather than resurrecting a finished card.
 */
function patchSlot(prev, index, event) {
  const slot = prev[index];
  if (!slot || slot.run !== event.run) return prev;

  if (event.type === "delta") {
    if (!slot.loading) return prev;
    const data = slot.data || { content: "", thinking: "" };
    const next = [...prev];
    next[index] = { ...slot, data: { ...data, [event.sink]: (data[event.sink] || "") + event.chunk } };
    return next;
  }

  if (event.type === "idle") {
    const next = [...prev];
    next[index] = { ...slot, loading: false, data: null };
    return next;
  }

  if (event.type === "stop") {
    if (!slot.loading) return prev;
    const partial = slot.data || {};
    const note = stoppedNote(partial);
    const kind = partial.content ? "text" : partial.thinking ? "thinking" : "empty";
    const next = [...prev];
    next[index] = {
      ...slot,
      loading: false,
      data: {
        ...slotData(),
        ok: true,
        kind,
        content: partial.content || "",
        thinking: partial.thinking || "",
        hint: kind === "empty" ? note : "",
        stopped: true,
        stoppedNote: note,
        ms: event.at - slot.startedAt,
        chars: (partial.content || "").length,
      },
    };
    return next;
  }

  const next = [...prev];
  next[index] = { ...slot, loading: false, data: event.data };
  return next;
}

export default function ArenaPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ArenaContent />
    </Suspense>
  );
}

function ArenaContent() {
  const [slots, setSlots] = useState(["", ""]);
  const [results, setResults] = useState([emptyResult(), emptyResult()]);
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState(0);
  const [pick, setPick] = useState(null);
  const [showPicker, setShowPicker] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [studioTargets, setStudioTargets] = useState({});
  const [activeApiKey, setActiveApiKey] = useState("");
  const controllers = useRef({});
  const runRef = useRef(0);

  const patch = useCallback(
    (index, event) => setResults((prev) => patchSlot(prev, index, event)),
    []
  );

  // A battle that outlives the page must not keep firing at a dead component.
  useEffect(() => {
    const map = controllers;
    return () => {
      for (const controller of Object.values(map.current)) controller.abort();
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [providersRes, aliasesRes, studioRes, keysRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/model-editor"),
          fetch("/api/keys"),
        ]);
        if (providersRes.ok) {
          const pData = await providersRes.json();
          setActiveProviders(pData.connections || []);
        }
        if (aliasesRes.ok) {
          const aData = await aliasesRes.json();
          setModelAliases(aData.aliases || {});
        }
        if (studioRes.ok) {
          const sData = await studioRes.json();
          const map = {};
          for (const studio of sData.models || []) map[studio.callName] = studio.targetModel;
          setStudioTargets(map);
        }
        if (keysRes.ok) {
          const kData = await keysRes.json();
          const firstActive = (kData.keys || []).find((k) => k.isActive !== false);
          if (firstActive?.key) setActiveApiKey(firstActive.key);
        }
      } catch (e) {
        console.error("Error loading battle inputs:", e);
      }
    };
    load();
  }, []);

  const setSlot = (index, value) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addSlot = () => {
    if (slots.length >= MAX_MODELS) return;
    setSlots((prev) => [...prev, ""]);
    setResults((prev) => [...prev, emptyResult()]);
  };

  const removeSlot = (index) => {
    if (slots.length <= MIN_MODELS) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
    setResults((prev) => prev.filter((_, i) => i !== index));
    setPick(null);
  };

  const runBattle = useCallback(async () => {
    if (!prompt.trim()) return;
    const id = runId + 1;
    runRef.current = id;
    setRunId(id);
    setPick(null);
    setResults(slots.map(() => ({ loading: true, run: id, startedAt: Date.now(), data: null })));

    await Promise.all(
      slots.map(async (model, index) => {
        if (!model.trim()) {
          patch(index, { type: "idle", run: id });
          return;
        }
        const controller = new AbortController();
        controllers.current[index] = controller;
        const started = Date.now();
        try {
          const answer = await streamChatCompletion({
            model: model.trim(),
            messages: [{ role: "user", content: prompt }],
            apiKey: activeApiKey,
            signal: controller.signal,
            onDelta: (chunk) => patch(index, { type: "delta", run: id, sink: "content", chunk }),
            onThinking: (chunk) => patch(index, { type: "delta", run: id, sink: "thinking", chunk }),
          });
          const usage = answer.usage || {};
          const content = answer.kind === "thinking" ? "" : answer.text || "";
          patch(index, {
            type: "final",
            run: id,
            data: {
              ...slotData(),
              ok: true,
              kind: answer.kind,
              content,
              thinking: answer.thinking || "",
              hint: answer.kind === "empty"
                ? describeEmptyResponse({ finishReason: answer.finishReason, usage, thinking: answer.thinking })
                : "",
              ms: answer.ms,
              ttftMs: answer.ttftMs,
              usage,
              cost: estimateCost(model.trim(), usage, studioTargets),
              chars: content.length,
            },
          });
        } catch (err) {
          if (err?.name === "AbortError") {
            patch(index, { type: "stop", run: id, at: Date.now() });
            return;
          }
          patch(index, {
            type: "final",
            run: id,
            data: {
              ...slotData(),
              kind: "error",
              content: err?.message || "The stream failed before the model answered.",
              detail: err?.detail || "",
              status: err?.status || "",
              cooldown: err?.cooldown || "",
              source: err?.model || "",
              ms: Date.now() - started,
            },
          });
        } finally {
          if (controllers.current[index] === controller) delete controllers.current[index];
        }
      })
    );
  }, [prompt, slots, runId, activeApiKey, studioTargets, patch]);

  // Stopping keeps whatever already streamed, so every controller aborts and each
  // card closes itself through the same patch path the streams use.
  const stopBattle = useCallback(() => {
    const run = runRef.current;
    for (const controller of Object.values(controllers.current)) controller.abort();
    controllers.current = {};
    const at = Date.now();
    setResults((prev) => {
      let next = prev;
      for (let index = 0; index < prev.length; index += 1) {
        next = patchSlot(next, index, { type: "stop", run, at });
      }
      return next;
    });
  }, []);

  const busy = results.some((r) => r.loading);
  const done = results.filter((r) => r.data);
  const ranked = useMemo(() => buildRanking(slots, results), [slots, results]);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold leading-none flex items-center gap-2">
          <span className="material-symbols-outlined size-[22px] text-[22px] leading-none shrink-0 text-primary">swords</span>
          Compare Models
        </h1>
        <p className="text-sm text-text-muted">
          Send the same prompt to up to {MAX_MODELS} models and compare speed, cost and output.
        </p>
        <p className="text-[11px] text-text-muted">
          Each answer streams live, so the time to first token shows a slow model still working.
        </p>
      </div>

      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {slots.map((model, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Contender {index + 1}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={model}
                    onChange={(e) => setSlot(index, e.target.value)}
                    placeholder="e.g. cc/claude-sonnet-4.5 - or pick one"
                    className="flex-1 font-mono text-sm"
                  />
                  <Button variant="secondary" icon="search" onClick={() => setShowPicker(index)} />
                </div>
              </div>
              {slots.length > MIN_MODELS && !busy && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  onClick={() => removeSlot(index)}
                  className="mb-1 shrink-0"
                  title={`Remove contender ${index + 1}`}
                />
              )}
            </div>
          ))}
        </div>

        {slots.length < MAX_MODELS && (
          <button
            onClick={addSlot}
            className="self-start flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add contender
          </button>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Prompt</label>
          <textarea
            className="w-full min-h-[120px] p-3 rounded-lg border border-border bg-surface-2 text-sm focus:outline-none focus:border-primary/50 transition-colors"
            placeholder="Write a python script to parse CSV..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button
            icon={busy ? "stop_circle" : "play_arrow"}
            onClick={busy ? stopBattle : runBattle}
            disabled={busy ? false : !prompt.trim() || !slots.some((s) => s.trim())}
            variant={busy ? "secondary" : "primary"}
          >
            {busy ? "Stop" : "Run Battle"}
          </Button>
        </div>
      </Card>

      {ranked.length > 1 && (
        <FinalResult ranked={ranked} pick={pick} setPick={setPick} runId={runId} />
      )}

      {(done.length > 0 || busy) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slots.map((model, index) => {
            const result = results[index]?.data;
            const loading = results[index]?.loading;
            if (!model && !loading && !result) return null;
            const streamed = loading && result ? result.content || result.thinking : "";
            return (
              <Card key={index} padding="sm" className="h-full flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-border mb-3">
                  <span className="font-mono text-sm font-semibold truncate min-w-0">{model || "n/a"}</span>
                  {loading && <Elapsed startedAt={results[index]?.startedAt} />}
                  {result && !loading && (
                    <span
                      className={`text-xs px-2 py-1 rounded font-mono shrink-0 ${
                        !result.ok
                          ? "bg-red-500/10 text-red-500"
                          : result.kind === "empty" || result.stopped
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {!result.ok
                        ? result.status
                          ? `HTTP ${result.status}`
                          : "failed"
                        : result.stopped
                          ? "stopped"
                          : result.kind === "empty"
                            ? "empty"
                            : `${result.ms}ms`}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-auto bg-surface-2/60 rounded-lg p-3 min-w-0 border border-border-subtle">
                  {streamed ? (
                    <pre className="text-sm font-mono whitespace-pre-wrap break-words min-w-0">
                      {streamed}
                      <span className="animate-pulse">▍</span>
                    </pre>
                  ) : loading ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
                      <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
                      <span className="text-sm">Waiting for the first token...</span>
                    </div>
                  ) : result ? (
                    <div className="flex flex-col h-full min-w-0">
                      {result.kind === "error" ? (
                        <div className="flex flex-col gap-2 min-w-0">
                          <p className="text-sm text-red-500 break-words min-w-0">{result.content}</p>
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            {result.status && (
                              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-mono">
                                HTTP {result.status}
                              </span>
                            )}
                            {result.cooldown && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                                {result.cooldown}
                              </span>
                            )}
                            {result.source && (
                              <span
                                title={result.source}
                                className="px-1.5 py-0.5 rounded-[var(--r-chip)] bg-surface-2 text-text-muted font-mono max-w-full truncate border border-border-subtle"
                              >
                                {result.source}
                              </span>
                            )}
                          </div>
                          {result.detail && (
                            <details className="min-w-0">
                              <summary className="cursor-pointer text-[11px] text-text-muted hover:text-primary">
                                Show the raw error
                              </summary>
                              <pre className="mt-1 max-h-40 overflow-auto custom-scrollbar whitespace-pre-wrap break-words rounded-[var(--r-chip)] bg-surface-2 p-2 text-[10px] text-text-muted border border-border-subtle">
                                {result.detail}
                              </pre>
                            </details>
                          )}
                        </div>
                      ) : result.kind === "empty" ? (
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <p className="text-sm text-amber-500 break-words min-w-0">{result.hint}</p>
                          {!result.stopped && (
                            <p className="text-[11px] text-text-muted">The provider answered with HTTP 200 and nothing inside.</p>
                          )}
                        </div>
                      ) : result.kind === "thinking" ? (
                        <div className="flex flex-col gap-1.5 min-w-0 h-full">
                          {!result.stopped && (
                            <p className="text-[11px] text-text-muted">Only reasoning came back, with no final answer.</p>
                          )}
                          <pre className="text-sm font-mono whitespace-pre-wrap flex-1 break-words min-w-0">
                            {result.thinking}
                          </pre>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 min-w-0 h-full">
                          <pre className="text-sm font-mono whitespace-pre-wrap flex-1 break-words min-w-0">
                            {result.content}
                          </pre>
                          {result.thinking && (
                            <details className="min-w-0">
                              <summary className="cursor-pointer text-[11px] text-text-muted hover:text-primary">
                                Show the reasoning behind this answer
                              </summary>
                              <pre className="mt-1 max-h-40 overflow-auto custom-scrollbar whitespace-pre-wrap break-words rounded-[var(--r-chip)] bg-surface-2 p-2 text-[11px] text-text-muted border border-border-subtle">
                                {result.thinking}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                      {result.ok && (
                        <div className="mt-4 pt-3 border-t border-border/50 text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                          {result.ttftMs != null && <span>first token in {result.ttftMs}ms</span>}
                          {result.ms != null && <span>total {result.ms}ms</span>}
                          {result.usage && (
                            <>
                              <span>in {result.usage?.prompt_tokens ?? 0}</span>
                              <span>out {result.usage?.completion_tokens ?? 0}</span>
                              <span>total {result.usage?.total_tokens ?? 0}</span>
                            </>
                          )}
                          {result.cost != null && <span>~{showCost(result.cost)}</span>}
                        </div>
                      )}
                      {result.stopped && result.kind !== "empty" && (
                        <p className="mt-2 text-[11px] text-amber-500 break-words min-w-0">{result.stoppedNote}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-40 text-text-muted text-sm">
                      No result
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showPicker !== null && (
        <ModelSelectModal
          isOpen
          onClose={() => setShowPicker(null)}
          onSelect={(modelObj) => {
            setSlot(showPicker, modelObj?.value || "");
            setShowPicker(null);
          }}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Pick contender ${showPicker + 1}`}
        />
      )}
    </div>
  );
}

/**
 * Rank finished runs. Quality can only be judged by reading, so the automatic
 * ranking is explicitly about speed + spend; a manual pick always wins.
 */
function buildRanking(slots, results) {
  return slots
    .map((model, index) => ({ model, index, slot: results[index] }))
    // A card that is still streaming holds a partial answer, so it is not rankable.
    .filter((entry) => entry.model && entry.slot?.data && !entry.slot.loading)
    .map((entry) => ({
      model: entry.model,
      index: entry.index,
      ok: entry.slot.data.ok,
      answered: entry.slot.data.ok && entry.slot.data.kind !== "empty",
      stopped: entry.slot.data.stopped,
      ms: entry.slot.data.ms,
      ttftMs: entry.slot.data.ttftMs,
      totalTokens: entry.slot.data.usage?.total_tokens ?? 0,
      cost: entry.slot.data.cost,
      chars: entry.slot.data.chars,
    }))
    .sort((a, b) => {
      if (a.answered !== b.answered) return a.answered ? -1 : 1;
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      // A cut-off answer is not a finish, so it ranks behind every complete one.
      if (a.stopped !== b.stopped) return a.stopped ? 1 : -1;
      const ta = a.ms ?? Number.MAX_SAFE_INTEGER;
      const tb = b.ms ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER);
    });
}

// One metric, described once: what it is, how a lower (or higher) number
// reads, how to render it, and which winner it produced. The winner rail, the
// table bars and the header all read from this single list, so a metric can
// never be shown as the winner in one place and left unbarred in another.
const METRIC_DEFS = [
 {
  key: "ms",
  label: "Fastest",
  icon: "speed",
  color: "#f59e0b",
  lowerIsBetter: true,
  value: (r) => (r.ms == null ? null : r.ms),
  format: (v) => `${v}ms`,
  hint: "total time to finish",
 },
 {
  key: "ttft",
  label: "First token",
  icon: "bolt",
  color: "#38bdf8",
  lowerIsBetter: true,
  value: (r) => (r.ttftMs == null ? null : r.ttftMs),
  format: (v) => `${v}ms`,
  hint: "time to first token",
 },
 {
  key: "cost",
  label: "Cheapest",
  icon: "payments",
  color: "#22c55e",
  lowerIsBetter: true,
  value: (r) => (r.cost == null ? null : r.cost),
  format: (v) => showCost(v),
  hint: "price of this answer",
 },
 {
  key: "tokens",
  label: "Leanest",
  icon: "data_usage",
  color: "#a855f7",
  lowerIsBetter: true,
  value: (r) => (r.totalTokens ? r.totalTokens : null),
  format: (v) => String(v),
  hint: "tokens billed",
 },
 {
  key: "chars",
  label: "Longest",
  icon: "article",
  color: "#f43f5e",
  lowerIsBetter: false,
  value: (r) => (r.chars ? r.chars : null),
  format: (v) => String(v),
  hint: "characters written",
 },
];

// Winner per metric, computed from the same pool the table shows: only finished,
// unstopped, answered runs compete.
function metricsFor(answered) {
  return METRIC_DEFS.map((def) => {
    const withValue = answered
      .map((r) => ({ r, v: def.value(r) }))
      .filter((x) => x.v != null && !Number.isNaN(x.v));
    if (!withValue.length) return { def, winner: null, best: null, worst: null };
    const sorted = withValue.slice().sort((a, b) =>
      def.lowerIsBetter ? a.v - b.v : b.v - a.v
    );
    return { def, winner: sorted[0].r, best: sorted[0].v, worst: sorted[sorted.length - 1].v };
  });
}

// Width of the bar for one value inside a metric. A single metric with one
// entrant gets a full bar; otherwise it is scaled against the worst value so
// the shape of the comparison is visible.
function barPct(v, best, worst) {
  if (v == null || best == null || worst == null) return 0;
  if (best === worst) return 100;
  const lo = Math.min(best, worst);
  const hi = Math.max(best, worst);
  // Floor at 8% so a cheap/fast entry is never invisible.
  return Math.max(8, Math.round(((v - lo) / (hi - lo)) * 92) + 8);
}

function FinalResult({ ranked, pick, setPick, runId }) {
  // An empty 200 response is not a win, and neither is an answer the user cut off,
  // so every award needs a real finished answer.
  const answered = ranked.filter((r) => r.answered && !r.stopped);
  const metrics = useMemo(() => metricsFor(answered), [ranked]);
  // Kept under the old names because the table below still refers to them; they
  // are now derived from the shared metric list instead of five hand-rolled
  // sorts that could disagree with the rail.
  const winners = {
    fastest: metrics.find((m) => m.def.key === "ms")?.winner || null,
    cheapest: metrics.find((m) => m.def.key === "cost")?.winner || null,
    leanest: metrics.find((m) => m.def.key === "tokens")?.winner || null,
    richest: metrics.find((m) => m.def.key === "chars")?.winner || null,
    firstToken: metrics.find((m) => m.def.key === "ttft")?.winner || null,
  };

  const leader = ranked[0];
  const manual = pick != null ? ranked.find((r) => r.index === pick) : null;
  const byKey = useMemo(
    () => Object.fromEntries(metrics.map((m) => [m.def.key, m])),
    [metrics]
  );

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-amber-500 text-[20px]">trophy</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-main">Final Result</h3>
            <p className="text-[11px] text-text-muted">
              {manual ? (
                <>Your pick: <code className="font-mono">{manual.model}</code></>
              ) : leader?.stopped ? (
                "Every run was stopped before it finished."
              ) : leader?.answered ? (
                <><code className="font-mono">{leader.model}</code> answered fastest - tap “My pick” below for quality.</>
              ) : (
                "No contender answered successfully."
              )}
            </p>
          </div>
        </div>
        <span className="text-[10px] text-text-muted">run #{runId}</span>
      </div>

      {answered.length > 1 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {metrics
            .filter((m) => m.winner)
            .map(({ def, winner, best }) => (
              <button
                key={def.key}
                type="button"
                onClick={() => setPick(winner.index)}
                title={`${def.hint} - tap to make it your pick`}
                className={`flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-colors ${
                  pick === winner.index
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-surface-2"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  <span
                    className="material-symbols-outlined text-[13px] leading-none"
                    style={{ color: def.color }}
                  >
                    {def.icon}
                  </span>
                  {def.label}
                </span>
                <span
                  className="text-lg font-bold font-mono tabular-nums leading-none"
                  style={{ color: def.color }}
                >
                  {def.format(best)}
                </span>
                <span className="text-[11px] font-mono text-text-main truncate">
                  {winner.model}
                </span>
              </button>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span className="material-symbols-outlined text-[12px] leading-none">info</span>
        <span>
          Ranked automatically on speed and spend only - bars compare the same
          metric across contenders. Answer quality is yours to judge, so use
          “My pick”.
        </span>
      </div>

      <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left py-2 pr-3 font-medium">Model</th>
              <th className="text-right py-2 px-3 font-medium">Time</th>
              <th className="text-right py-2 px-3 font-medium">First token</th>
              <th className="text-right py-2 px-3 font-medium">Tokens</th>
              <th className="text-right py-2 px-3 font-medium">Cost</th>
              <th className="text-right py-2 pl-3 font-medium">My pick</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry, position) => {
              const isWinner = position === 0 && entry.answered && !entry.stopped && pick == null;
              const isPicked = pick === entry.index;
              return (
                <tr
                  key={entry.index}
                  className={`border-b border-border/50 last:border-0 ${isPicked ? "bg-primary/5" : ""}`}
                >
                  <td className="py-2 pr-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-text-muted tabular-nums w-4 shrink-0">{position + 1}</span>
                      <code className="font-mono text-text-main truncate max-w-[220px]">{entry.model}</code>
                      {isWinner && <Badge icon="trophy" text="fastest" />}
                      {winners.firstToken?.index === entry.index && <Badge icon="bolt" text="first token" />}
                      {winners.cheapest?.index === entry.index && <Badge icon="payments" text="cheapest" />}
                      {winners.richest?.index === entry.index && winners.richest?.index !== winners.leanest?.index && (
                        <Badge icon="article" text="longest" />
                      )}
                      {entry.stopped && <Badge icon="stop_circle" text="stopped" />}
                      {isPicked && <Badge icon="check" text="your pick" accent />}
                    </div>
                    {!entry.answered && !entry.stopped && (
                  <span className={`text-[11px] ${entry.ok ? "text-amber-500" : "text-red-500"}`}>
                    {entry.ok ? "empty answer" : "failed"}
                  </span>
                )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <MetricCell entry={entry} metric={byKey.ms} format={(v) => (v == null ? "n/a" : `${v}ms`)} />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <MetricCell entry={entry} metric={byKey.ttft} format={(v) => (v == null ? "n/a" : `${v}ms`)} />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <MetricCell
                      entry={entry}
                      metric={byKey.tokens}
                      format={(v) => (v == null ? "n/a" : String(v))}
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <MetricCell entry={entry} metric={byKey.cost} format={(v) => showCost(v)} />
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <button
                      onClick={() => setPick(isPicked ? null : entry.index)}
                      className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        isPicked
                          ? "bg-primary text-white border-primary"
                          : "border-border text-text-muted hover:text-primary hover:border-primary/50"
                      }`}
                    >
                      {isPicked ? "picked" : "pick"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Number plus bar. The bar is what makes the comparison readable; the digits
// stay for exactness. A missing value shows a dash and no bar rather than a
// zero-length bar that would read as "fastest".
function MetricCell({ entry, metric, format }) {
  if (!metric) return <span className="font-mono tabular-nums text-text-muted">-</span>;
  const v = metric.def.value(entry);
  if (v == null) return <span className="font-mono tabular-nums text-text-muted">-</span>;
  const isWinner = metric.winner?.index === entry.index;
  const pct = barPct(v, metric.best, metric.worst);
  return (
    <span className="flex flex-col items-end gap-1">
      <span
        className={`font-mono tabular-nums ${isWinner ? "font-semibold" : ""}`}
        style={isWinner ? { color: metric.def.color } : undefined}
      >
        {format(v)}
        {isWinner ? (
          <span className="material-symbols-outlined align-middle ml-0.5 text-[11px] leading-none">
            star
          </span>
        ) : null}
      </span>
      <span className="block w-full min-w-[42px] max-w-[90px] h-1 rounded-full bg-surface-2 overflow-hidden">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: metric.def.color,
            opacity: isWinner ? 1 : 0.45,
          }}
        />
      </span>
    </span>
  );
}

// Ticking lives on the card so a running timer never re-renders the whole grid.
function Elapsed({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  if (!startedAt) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="shrink-0 text-[11px] font-mono text-text-muted tabular-nums">
      {`${seconds}s so far`}
    </span>
  );
}

function Badge({ icon, text, accent }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${
        accent ? "bg-primary/15 text-primary" : "bg-surface-2 text-text-muted border border-border-subtle"
      }`}
    >
      <span className="material-symbols-outlined text-[11px]">{icon}</span>
      {text}
    </span>
  );
}

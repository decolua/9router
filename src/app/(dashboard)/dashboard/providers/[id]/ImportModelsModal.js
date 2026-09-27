"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { Button, Modal, Badge, Toggle, Select, Input, ErrorReason } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
import {
  applyImportFilters,
  normalizeImportFilters,
  DEFAULT_IMPORT_FILTERS,
  IMPORT_TIERS,
  IMPORT_KINDS,
  MIN_CONTEXT_OPTIONS,
  formatContextLength,
  formatPricePerMillion,
} from "@/shared/utils/importProviderModels.js";
import { splitNdjsonLines, flushNdjsonBuffer } from "@/shared/utils/ndjson.js";
import { MODEL_CHIP_CLASS } from "./ModelMetaChips";

const TIER_BADGE_VARIANT = { free: "success", paid: "default", credits: "warning", unknown: "default" };

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Kinds are ids ("llm", "tts"); acronyms read wrong when merely capitalized.
const KIND_LABELS = { llm: "LLM", tts: "TTS", stt: "STT" };
const kindLabel = (kind) => KIND_LABELS[kind] || capitalize(kind);

// Small pill-style toggle used for the tier/kind filter chips. Not a shared
// component — this shape (active = filled brand color) only exists here.
function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-brand-500 border-brand-500 text-white"
          : "border-black/10 dark:border-white/10 text-text-muted hover:text-text-main hover:border-brand-500/40"
      )}
    >
      {children}
    </button>
  );
}

// Row status icon for the import-progress list. Collapses the NDJSON event
// sequence (testing -> tested -> imported|failed) down to the three states
// the brief calls for: testing / ok+imported / failed.
function StatusIcon({ status }) {
  if (status === "testing") {
    return <span className="material-symbols-outlined animate-spin text-[18px] text-blue-500">progress_activity</span>;
  }
  if (status === "imported") {
    return <span className="material-symbols-outlined text-[18px] text-green-500">check_circle</span>;
  }
  if (status === "failed") {
    return <span className="material-symbols-outlined text-[18px] text-red-500">cancel</span>;
  }
  return <span className="material-symbols-outlined text-[18px] text-text-muted">radio_button_unchecked</span>;
}

export default function ImportModelsModal({ isOpen, onClose, providerId, onImported }) {
  // Load phase: loading (GET in flight) -> browse (picking) -> running (POST
  // stream in flight) -> done (stream finished, summary shown). "error" is a
  // GET failure; the running phase's own failures surface as runError while
  // staying in "done" once the stream ends.
  const [phase, setPhase] = useState("loading");
  const [fetchError, setFetchError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  const [candidates, setCandidates] = useState([]);
  const [rule, setRule] = useState(null);
  const [listWarning, setListWarning] = useState(null);

  const [filters, setFilters] = useState(DEFAULT_IMPORT_FILTERS);
  const [testFirst, setTestFirst] = useState(true);
  const [saveRule, setSaveRule] = useState(false);
  // Phones: the id pattern fields stay folded so the model list keeps its room.
  const [showIdFilters, setShowIdFilters] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const [runModels, setRunModels] = useState([]);
  const [progress, setProgress] = useState({});
  const [summary, setSummary] = useState(null);
  const [runError, setRunError] = useState(null);

  const abortControllerRef = useRef(null);

  // Fetch candidates + saved rule. State starts fresh because the parent mounts
  // this component only while the dialog is open ({open && <ImportModelsModal/>}),
  // so nothing needs resetting here. `retryToken` lets the error state's Retry
  // button re-run the fetch without duplicating it.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    fetch(`/api/models/import/${providerId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
        setListWarning(data?.warning || null);
        if (data?.rule) {
          setRule(data.rule);
          setFilters(normalizeImportFilters(data.rule.filters));
          setTestFirst(data.rule.testFirst !== false);
          setSaveRule(true);
        }
        setPhase("browse");
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err?.message || String(err));
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, providerId, retryToken]);

  // Abort an in-flight import if the component unmounts mid-stream.
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const filteredCandidates = useMemo(() => applyImportFilters(candidates, filters), [candidates, filters]);

  // A saved rule applies to every matching model on the next daily run, not
  // just what's checked here — surface that gap so "N more" is never a
  // surprise import later.
  const additionalRuleMatches = useMemo(
    () => filteredCandidates.filter((c) => !c.alreadyImported && !selected.has(c.id)).length,
    [filteredCandidates, selected]
  );

  const presentKinds = useMemo(
    () => IMPORT_KINDS.filter((kind) => candidates.some((c) => c.kind === kind)),
    [candidates]
  );

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleListFilter = (key, value) => {
    setFilters((prev) => {
      const list = prev[key] || [];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [key]: next };
    });
  };

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filteredCandidates) {
        if (!c.alreadyImported) next.add(c.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // Apply one batch of parsed NDJSON events onto progress/summary/runError state.
  const applyEvents = (events) => {
    if (!events.length) return;

    setProgress((prev) => {
      const next = { ...prev };
      for (const event of events) {
        if (!event || typeof event !== "object" || typeof event.id !== "string") continue;
        if (event.type === "testing") {
          next[event.id] = { ...(next[event.id] || {}), status: "testing" };
        } else if (event.type === "tested" && !event.ok) {
          // Interim failure signal — the "failed" event that follows carries
          // the same error, but set it here too in case it never arrives.
          next[event.id] = { ...(next[event.id] || {}), status: "failed", error: event.error };
        } else if (event.type === "imported") {
          next[event.id] = { ...(next[event.id] || {}), status: "imported" };
        } else if (event.type === "failed") {
          next[event.id] = { ...(next[event.id] || {}), status: "failed", error: event.error };
        }
      }
      return next;
    });

    const doneEvent = events.find((e) => e?.type === "done");
    if (doneEvent) setSummary({ imported: doneEvent.imported, failed: doneEvent.failed });

    const errorEvent = events.find((e) => e?.type === "error");
    if (errorEvent) setRunError(errorEvent.error || translate("Import failed"));
  };

  const handleImport = async () => {
    const modelsToImport = candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({ id: c.id, kind: c.kind, name: c.name, contextLength: c.contextLength, reasoning: c.reasoning }));
    if (modelsToImport.length === 0) return;

    // Persist or clear the daily auto-import rule alongside the import
    // itself. Best-effort: a failure here should not block the import.
    (async () => {
      try {
        if (saveRule) {
          await fetch(`/api/models/import/${providerId}/rule`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filters, testFirst }),
          });
        } else if (rule) {
          await fetch(`/api/models/import/${providerId}/rule`, { method: "DELETE" });
        }
      } catch (err) {
        console.warn("Failed to update auto-import rule:", err);
      }
    })();

    const initialProgress = {};
    for (const m of modelsToImport) initialProgress[m.id] = { status: "queued" };

    setRunModels(modelsToImport);
    setProgress(initialProgress);
    setSummary(null);
    setRunError(null);
    setPhase("running");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(`/api/models/import/${providerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: modelsToImport, testFirst }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        const split = splitNdjsonLines(buffer, chunkText);
        buffer = split.remainder;
        applyEvents(split.events);
      }
      applyEvents(flushNdjsonBuffer(buffer));

      setPhase("done");
      onImported();
    } catch (err) {
      if (err?.name === "AbortError") {
        // Cancel stops runImport from *starting* new models, but anything
        // already in flight may have finished and landed in the DB — refresh
        // the parent's model list rather than leaving it stale.
        onImported();
        return;
      }
      setRunError(err?.message || String(err));
      setPhase("done");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleRetry = () => {
    setFetchError(null);
    setPhase("loading");
    setRetryToken((n) => n + 1);
  };

  const handleClose = () => {
    if (phase === "running") abortControllerRef.current?.abort();
    onClose();
  };

  const doneCount = useMemo(
    () => Object.values(progress).filter((p) => p.status === "imported" || p.status === "failed").length,
    [progress]
  );
  const percent = runModels.length ? Math.round((doneCount / runModels.length) * 100) : 0;

  let footer = null;
  if (phase === "browse") {
    footer = (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Toggle
              size="sm"
              checked={testFirst}
              onChange={setTestFirst}
              label={translate("Test before import (only working models are imported)")}
            />
            <Toggle
              size="sm"
              checked={saveRule}
              onChange={setSaveRule}
              label={translate("Use these filters for daily auto-import")}
            />
            {saveRule && additionalRuleMatches > 0 && (
              <p className="text-[11px] text-text-muted pl-8">
                {translate("Daily run will also import")} {additionalRuleMatches}{" "}
                {translate("more matching models you didn't select")}
              </p>
            )}
            <Link href="/dashboard/profile" className="text-xs text-brand-500 hover:underline">
              {translate("Daily auto-import is configured in Settings")}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleClose}>
              {translate("Cancel")}
            </Button>
            <Button onClick={handleImport} disabled={selected.size === 0}>
              {translate("Import")} ({selected.size})
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (phase === "running") {
    footer = (
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-xs text-text-muted">
          {doneCount}/{runModels.length} {translate("done")}
        </span>
        <Button variant="ghost" onClick={handleClose}>
          {translate("Cancel")}
        </Button>
      </div>
    );
  } else if (phase === "done") {
    footer = (
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-xs text-text-muted">
          {summary
            ? `${summary.imported} ${translate("imported")}, ${summary.failed} ${translate("failed")}`
            : translate("Import finished")}
        </span>
        <Button onClick={onClose}>{translate("Close")}</Button>
      </div>
    );
  } else {
    footer = (
      <Button variant="ghost" onClick={onClose}>
        {translate("Close")}
      </Button>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={translate("Import Models")} size="full" footer={footer}>
      {phase === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
          {translate("Loading models...")}
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="material-symbols-outlined text-3xl text-red-500">error</span>
          <p className="text-sm text-text-muted break-words">{fetchError}</p>
          <Button variant="secondary" onClick={handleRetry}>
            {translate("Retry")}
          </Button>
        </div>
      )}

      {phase === "browse" && (
        <div className="flex flex-col gap-4">
          {/* Filter bar */}
          <div className="flex flex-col gap-3">
            <Input
              type="text"
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              placeholder={translate("Search models...")}
              icon="search"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {IMPORT_TIERS.map((tier) => (
                <FilterChip key={tier} active={filters.tiers.includes(tier)} onClick={() => toggleListFilter("tiers", tier)}>
                  {translate(capitalize(tier))}
                </FilterChip>
              ))}
              {presentKinds.length > 1 && (
                <>
                  <span className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" aria-hidden="true" />
                  {presentKinds.map((kind) => (
                    <FilterChip key={kind} active={filters.kinds.includes(kind)} onClick={() => toggleListFilter("kinds", kind)}>
                      {translate(kindLabel(kind))}
                    </FilterChip>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Toggle size="sm" checked={filters.onlyNew} onChange={(v) => setFilter("onlyNew", v)} label={translate("Only new")} />
              <div className="min-w-[170px]">
                <Select
                  selectClassName="py-1.5"
                  value={String(filters.minContext)}
                  onChange={(e) => setFilter("minContext", Number(e.target.value))}
                  options={MIN_CONTEXT_OPTIONS.map((o) => ({ value: String(o.value), label: o.value ? `${translate("Context")} ≥ ${o.label}` : translate("Any context") }))}
                  placeholder={translate("Min context")}
                  aria-label={translate("Minimum context")}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowIdFilters((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary sm:hidden"
                aria-expanded={showIdFilters || Boolean(filters.include || filters.exclude)}
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
                {translate("Id filters")}
                {(filters.include || filters.exclude) && <span className="size-1.5 rounded-full bg-primary" />}
              </button>
            </div>

            <div className={cn("grid-cols-1 gap-3 sm:grid sm:grid-cols-2", showIdFilters || filters.include || filters.exclude ? "grid" : "hidden")}>
              <Input
                type="text"
                value={filters.include}
                onChange={(e) => setFilter("include", e.target.value)}
                label={translate("Include ids")}
                placeholder="*-preview, *:free"
              />
              <Input
                type="text"
                value={filters.exclude}
                onChange={(e) => setFilter("exclude", e.target.value)}
                label={translate("Exclude ids")}
                placeholder="*-preview, *:free"
              />
            </div>
          </div>

          {/* Selection header */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={selectAllVisible}>
                {translate("Select all visible")}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                {translate("Clear")}
              </Button>
            </div>
            <span className="text-text-muted">
              {selected.size} {translate("selected of")} {filteredCandidates.length} {translate("visible")}
            </span>
          </div>

          {/* Candidate list */}
          <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
            {filteredCandidates.length === 0 && (
              <div className="text-center py-8 text-text-muted text-sm break-words">
                {candidates.length === 0 && listWarning
                  ? listWarning
                  : translate("No models match these filters")}
              </div>
            )}
            {filteredCandidates.map((c) => {
              const contextLabel = formatContextLength(c.contextLength);
              const promptLabel = c.pricing ? formatPricePerMillion(c.pricing.prompt) : null;
              const completionLabel = c.pricing ? formatPricePerMillion(c.pricing.completion) : null;
              // OpenRouter marks routers/variable pricing with negative prices.
              const variablePrice = c.pricing && (Number(c.pricing.prompt) < 0 || Number(c.pricing.completion) < 0);
              const priceLabel = variablePrice
                ? translate("Variable price")
                : promptLabel !== null || completionLabel !== null
                  ? `$${promptLabel ?? "?"} / $${completionLabel ?? "?"} ${translate("per 1M tokens")}`
                  : null;

              return (
                <label
                  key={c.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10",
                    c.alreadyImported ? "opacity-60" : "hover:bg-surface-2 cursor-pointer"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    disabled={c.alreadyImported}
                    onChange={() => toggleSelected(c.id)}
                    className="size-4 shrink-0 rounded accent-brand-500 disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0 break-all font-mono text-xs text-text-main">{c.id}</span>
                  {c.name && c.name !== c.id && <span className="text-xs text-text-muted">({c.name})</span>}
                  <Badge variant={TIER_BADGE_VARIANT[c.tier] || "default"} size="sm">
                    {translate(capitalize(c.tier))}
                  </Badge>
                  <Badge variant="default" size="sm">
                    {translate(kindLabel(c.kind))}
                  </Badge>
                  {contextLabel && (
                    <span className={`${MODEL_CHIP_CLASS} border-border bg-black/[0.03] font-mono tabular-nums text-text-muted dark:bg-white/[0.04]`} title={`${translate("Context window")}: ${Number(c.contextLength).toLocaleString()} tokens`}>
                      <span className="material-symbols-outlined text-[12px]">memory</span>
                      {contextLabel}
                    </span>
                  )}
                  {c.reasoning === true && (
                    <span className={`${MODEL_CHIP_CLASS} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`}>
                      <span className="material-symbols-outlined text-[12px]">neurology</span>
                      {translate("Reasoning")}
                    </span>
                  )}
                  {priceLabel && <span className="text-[11px] text-text-muted">{priceLabel}</span>}
                  {c.alreadyImported && (
                    <Badge variant="info" size="sm">
                      {translate("Imported")}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {(phase === "running" || phase === "done") && (
        <div className="flex flex-col gap-3">
          <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${percent}%` }} />
          </div>

          {runError && (
            <div className="flex items-start gap-2 text-sm text-red-500">
              <span className="material-symbols-outlined text-base shrink-0">error</span>
              <span className="break-words">{runError}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
            {runModels.map((m) => {
              const p = progress[m.id] || {};
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10"
                >
                  <StatusIcon status={p.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-text-main truncate">{m.id}</div>
                    {p.status === "failed" && p.error && (
                      <ErrorReason error={p.error} compact className="text-[11px]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

ImportModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerId: PropTypes.string.isRequired,
  onImported: PropTypes.func.isRequired,
};

FilterChip.propTypes = {
  active: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node,
};

StatusIcon.propTypes = {
  status: PropTypes.string,
};

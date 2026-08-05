"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import SegmentedControl from "./SegmentedControl";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function ComboTestModal({ isOpen, combo, onClose, strategy = {} }) {
  const [testing, setTesting] = useState(false);
  const [prompt, setPrompt] = useState("Halo, berikan respon singkat.");
  const [mode, setMode] = useState("fallback"); // "fallback" or "all"
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();

  const fallbackStrategy = strategy.fallbackStrategy || "fallback";

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setError("");
    }
  }, [isOpen, combo]);

  if (!combo) return null;

  const handleRunTest = async () => {
    setTesting(true);
    setError("");
    setResult(null);

    try {
      const endpoint = combo.id ? `/api/combos/${combo.id}/test` : "/api/combos/test";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: combo.name,
          models: combo.models,
          kind: combo.kind || "llm",
          prompt: prompt.trim() || "Halo, berikan respon singkat.",
          mode,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || "Failed to execute combo test");
      }
    } catch (err) {
      console.error("Error testing combo:", err);
      setError("Network or server error during combo test");
    } finally {
      setTesting(false);
    }
  };

  const modeOptions = [
    { value: "fallback", label: "Fallback Mode (Real Request)" },
    { value: "all", label: "Full Diagnostic (All Models)" },
  ];

  const fallbacksCount = result?.steps?.filter((s) => s.fallbackTriggered).length || 0;

  const getCopyableSummary = () => {
    if (!result) return "";
    let txt = `Combo Test: ${result.comboName}\nStatus: ${result.comboStatus.toUpperCase()}\nServing Model: ${result.servingModel || "None"}\nTotal Latency: ${result.totalLatencyMs}ms\n\nSteps:\n`;
    result.steps.forEach((s) => {
      if (s.skipped) {
        txt += `#${s.index} ${s.model}: SKIPPED (${s.reason})\n`;
      } else if (s.ok) {
        txt += `#${s.index} ${s.model}: OK (${s.latencyMs}ms) - SERVED REQUEST\n  Preview: ${s.preview || "N/A"}\n`;
      } else {
        txt += `#${s.index} ${s.model}: FAILED (${s.latencyMs}ms) - ${s.error}\n`;
      }
    });
    return txt;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Test Combo: ${combo.name}`}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {/* Header summary & sequence pipeline */}
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">layers</span>
              <code className="font-mono text-sm font-semibold text-text-main">{combo.name}</code>
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary capitalize">
                Strategy: {fallbackStrategy}
              </span>
            </div>
            <span className="text-xs text-text-muted">
              {combo.models?.length || 0} model(s) in fallback sequence
            </span>
          </div>

          {/* Model order chain */}
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1 custom-scrollbar text-xs">
            {combo.models?.map((model, i) => (
              <div key={i} className="flex shrink-0 items-center gap-1.5">
                <span className="flex items-center gap-1 rounded bg-surface border border-border-subtle px-2 py-1 font-mono text-[11px] text-text-main shadow-xs">
                  <span className="text-[10px] text-text-muted font-bold">#{i + 1}</span>
                  <span className="truncate max-w-[140px]">{model}</span>
                  <CapacityBadges caps={getCaps?.(model)} />
                </span>
                {i < combo.models.length - 1 && (
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Input & Mode Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <Input
              label="Test Prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter test prompt..."
              disabled={testing}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Execution Mode</label>
            <SegmentedControl
              options={modeOptions}
              value={mode}
              onChange={setMode}
              disabled={testing}
            />
          </div>
        </div>

        {/* Action button */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-text-muted">
            {mode === "fallback"
              ? "Evaluates models in order until one succeeds (simulates real client hit)."
              : "Tests every model in order to verify individual model availability."}
          </p>
          <Button
            onClick={handleRunTest}
            loading={testing}
            disabled={testing || !combo.models?.length}
            icon="play_arrow"
            size="sm"
          >
            {testing ? "Running Combo Test..." : "Run Test"}
          </Button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-500 flex items-start gap-2">
            <span className="material-symbols-outlined text-lg shrink-0">error</span>
            <div>
              <p className="font-semibold mb-0.5">Test Error</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Testing status spinner */}
        {testing && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 border border-dashed border-border-subtle rounded-lg bg-surface-2/50">
            <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-xs font-medium text-text-main animate-pulse">
              Testing hit to combo models based on sequence...
            </p>
            <p className="text-[11px] text-text-muted">
              Simulating fallbacks if upstream models return errors.
            </p>
          </div>
        )}

        {/* Results View */}
        {result && !testing && (
          <div className="flex flex-col gap-3">
            {/* Overall status card */}
            <div
              className={`rounded-lg p-3.5 border ${
                result.comboStatus === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-xl">
                    {result.comboStatus === "success" ? "check_circle" : "cancel"}
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold leading-snug">
                      {result.comboStatus === "success"
                        ? "Combo Test Succeeded"
                        : "Combo Test Failed"}
                    </h4>
                    <p className="text-xs opacity-90">
                      {result.comboStatus === "success"
                        ? `Served by model #${result.servedStepIndex}: ${result.servingModel}`
                        : "All models in combo failed to respond"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs font-medium">
                  {fallbacksCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                      <span className="material-symbols-outlined text-[14px]">swap_calls</span>
                      {fallbacksCount} Fallback{fallbacksCount > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="rounded bg-black/10 dark:bg-white/10 px-2 py-0.5">
                    Total: {result.totalLatencyMs}ms
                  </span>
                </div>
              </div>
            </div>

            {/* Sequence Steps */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted">
                  Fallback Execution Sequence ({result.steps?.length || 0} steps)
                </span>
                <button
                  onClick={() => copy(getCopyableSummary(), "combo-test-summary")}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === "combo-test-summary" ? "check" : "content_copy"}
                  </span>
                  {copied === "combo-test-summary" ? "Copied Summary" : "Copy Diagnostic Summary"}
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {result.steps?.map((step) => (
                  <div
                    key={step.index}
                    className={`rounded-lg border p-3 text-xs transition-all ${
                      step.servedRequest
                        ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/10 shadow-xs"
                        : step.fallbackTriggered
                        ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10"
                        : "border-border-subtle bg-surface-2 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`size-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                            step.servedRequest
                              ? "bg-emerald-500 text-white"
                              : step.fallbackTriggered
                              ? "bg-amber-500 text-white"
                              : "bg-black/20 dark:bg-white/20 text-text-muted"
                          }`}
                        >
                          {step.index}
                        </span>

                        <code className="font-mono text-xs font-semibold text-text-main truncate">
                          {step.model}
                        </code>
                      </div>

                      {/* Status badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        {step.servedRequest && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold px-2 py-0.5 text-[10px]">
                            <span className="material-symbols-outlined text-[12px]">verified</span>
                            SERVED REQUEST
                          </span>
                        )}

                        {step.fallbackTriggered && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold px-2 py-0.5 text-[10px]">
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                            FALLBACK TRIGGERED
                          </span>
                        )}

                        {step.skipped && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-black/10 dark:bg-white/10 text-text-muted font-medium px-2 py-0.5 text-[10px]">
                            <span className="material-symbols-outlined text-[12px]">skip_next</span>
                            SKIPPED
                          </span>
                        )}

                        {!step.skipped && (
                          <span className="font-mono text-[11px] text-text-muted">
                            {step.latencyMs}ms
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Fallback error reason */}
                    {step.fallbackTriggered && (
                      <div className="mt-2 rounded bg-red-500/10 border border-red-500/20 p-2 font-mono text-[11px] text-red-500 break-words">
                        <span className="font-bold">Error: </span>
                        {step.error || `HTTP ${step.status}`}
                      </div>
                    )}

                    {/* Output preview */}
                    {step.servedRequest && step.preview && (
                      <div className="mt-2 rounded bg-surface p-2 border border-emerald-500/30 text-[11px] text-text-main font-mono whitespace-pre-wrap max-h-24 overflow-y-auto custom-scrollbar">
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold block mb-0.5">
                          Output Preview:
                        </span>
                        {step.preview}
                      </div>
                    )}

                    {/* Skipped reason */}
                    {step.skipped && (
                      <div className="mt-1 text-[11px] text-text-muted italic">
                        {step.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

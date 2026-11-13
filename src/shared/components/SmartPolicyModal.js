"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Badge from "./Badge";

const QUICK_THRESHOLDS = [60, 70, 75, 80, 85, 90];

export default function SmartPolicyModal({
  isOpen,
  onClose,
  comboName,
  currentPolicy = "smart",
  currentThreshold = 80,
  currentInstructions = "",
  onSave,
}) {
  const [selectedPolicy, setSelectedPolicy] = useState("smart");
  const [threshold, setThreshold] = useState(80);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    if (isOpen) {
      let initialPolicy = currentPolicy || "smart";
      if (initialPolicy.startsWith("smart-switch")) {
        initialPolicy = "smart";
      }
      setSelectedPolicy(initialPolicy);
      const parsedThresh = Math.round((currentThreshold || 0.8) * (currentThreshold <= 1 ? 100 : 1));
      setThreshold(parsedThresh || 80);
      setInstructions(typeof currentInstructions === "string" ? currentInstructions : "");
    }
  }, [isOpen, currentPolicy, currentThreshold, currentInstructions]);

  const handleSave = () => {
    const finalThreshold = selectedPolicy === "custom"
      ? threshold / 100
      : selectedPolicy === "smart"
        ? 0.8
        : 0;

    onSave({
      smartPolicy: selectedPolicy,
      sessionSticky: selectedPolicy !== "per-turn",
      confidenceThreshold: finalThreshold,
      smartInstructions: instructions.trim(),
    });
    onClose();
  };

  const policies = [
    {
      id: "smart",
      title: "Smart Switch",
      badge: "Adaptive ≥80%",
      badgeVariant: "success",
      icon: "auto_mode",
      recommended: true,
      desc: "Preserves warm prompt cache across turns. Seamlessly switches models if the conversation topic shifts with high confidence (≥80%).",
    },
    {
      id: "strict",
      title: "Strict Lock",
      badge: "1 Task = 1 Session",
      badgeVariant: "default",
      icon: "lock",
      desc: "Evaluates System One on turn 1, then locks that model for the entire session. Adds +0ms latency and zero extra router calls (100% prompt cache reuse).",
    },
    {
      id: "per-turn",
      title: "Per-Turn",
      badge: "Dynamic",
      badgeVariant: "default",
      icon: "refresh",
      desc: "Evaluates System One independently on every prompt without session stickiness.",
    },
    {
      id: "custom",
      title: "Custom Threshold",
      badge: `Adaptive ≥${threshold}%`,
      badgeVariant: "default",
      icon: "tune",
      desc: "Configure your own confidence threshold required to trigger a model switch.",
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Router Policy — ${comboName || "Combo"}`}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Choose how the System One router manages model selection across conversation turns:
        </p>

        <div className="flex flex-col gap-2.5">
          {policies.map((p) => {
            const isSelected = selectedPolicy === p.id;
            return (
              <div
                key={p.id}
                onClick={() => setSelectedPolicy(p.id)}
                className={`relative flex flex-col rounded-xl border p-3 cursor-pointer transition-all ${
                  isSelected
                    ? "border-primary bg-primary/[0.04] shadow-sm"
                    : "border-border/60 hover:border-border hover:bg-black/[0.01] dark:hover:bg-white/[0.01]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                        isSelected
                          ? "border-primary bg-primary text-white"
                          : "border-border-subtle bg-surface"
                      }`}
                    >
                      {isSelected && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="size-5 rounded flex items-center justify-center shrink-0 text-text-muted">
                      <span className="material-symbols-outlined text-[15px] leading-none select-none inline-block">
                        {p.icon}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-text-main">
                      {p.title}
                    </span>
                    {p.recommended && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <Badge variant={p.badgeVariant} size="sm">
                    {p.badge}
                  </Badge>
                </div>

                <p className="text-xs text-text-muted mt-1.5 pl-6 leading-relaxed">
                  {p.desc}
                </p>

                {/* Custom Threshold Slider & Chips */}
                {p.id === "custom" && isSelected && (
                  <div
                    className="mt-3 pl-6 pt-3 border-t border-border/40 flex flex-col gap-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-muted">Switch Confidence Threshold:</span>
                      <span className="font-mono font-semibold text-primary text-sm">{threshold}%</span>
                    </div>

                    <input
                      type="range"
                      min="50"
                      max="95"
                      step="1"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full accent-primary cursor-pointer h-1.5 bg-black/10 dark:bg-white/10 rounded-lg appearance-none"
                    />

                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-text-muted mr-1">Presets:</span>
                      {QUICK_THRESHOLDS.map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setThreshold(pct)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            threshold === pct
                              ? "bg-primary text-white font-semibold"
                              : "bg-black/5 dark:bg-white/5 text-text-muted hover:text-text-main"
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="smart-routing-instructions" className="text-sm font-medium text-text-main">
            Routing instructions <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="smart-routing-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            placeholder="Describe when to choose each model, using the model IDs configured in this combo."
            aria-describedby="smart-routing-instructions-help"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:border-primary resize-y"
          />
          <p id="smart-routing-instructions-help" className="text-xs text-text-muted">
            Guide this combo&apos;s model selection by capability, cost or speed. Leave blank to use the default routing instructions.
          </p>
        </div>

        {/* Prompt Cache Benefit Callout */}
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3 text-xs flex items-start gap-2.5">
          <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">
            bolt
          </span>
          <div className="text-text-muted leading-relaxed">
            <span className="font-medium text-text-main">Prompt Cache Benefits: </span>
            Retaining the same model across session turns keeps upstream prompt caches warm,
            reducing input token costs by up to <strong className="text-text-main">90%</strong> and
            cutting latency in half (Claude Prompt Cache, DeepSeek KV-cache, Gemini Implicit Cache).
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save Policy
          </Button>
        </div>
      </div>
    </Modal>
  );
}

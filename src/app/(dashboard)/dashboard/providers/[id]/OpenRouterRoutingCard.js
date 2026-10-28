"use client";

import { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { Card, Badge } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { OPENROUTER_QUANTIZATIONS, OPENROUTER_PRECISION_PRESETS } from "open-sse/config/openrouterRouting.js";

function precisionPreset(quantizations = []) {
  return Object.keys(OPENROUTER_PRECISION_PRESETS).find((key) => {
    const formats = OPENROUTER_PRECISION_PRESETS[key];
    return formats.length === quantizations.length && formats.every((format) => quantizations.includes(format));
  }) || "custom";
}

export default function OpenRouterRoutingCard({ providerId }) {
  const notify = useNotificationStore();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [routing, setRouting] = useState({});
  const [preset, setPreset] = useState("unrestricted");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/providers/${encodeURIComponent(providerId)}/overrides`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load routing policy");
        if (cancelled) return;
        const policy = data.routing || {};
        setRouting(policy);
        setPreset(precisionPreset(policy.quantizations));
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load routing policy");
      });
    return () => { cancelled = true; };
  }, [providerId]);

  const save = async (policy) => {
    if (!loaded || saving) return;
    if (policy && preset === "custom" && !policy.quantizations?.length) {
      setError("Select at least one custom format, or choose Unrestricted.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing: policy ? {
          ...policy,
          quantizations: policy.quantizations?.length ? policy.quantizations : undefined,
        } : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save routing policy");
      }
      setRouting(policy || {});
      setPreset(precisionPreset(policy?.quantizations));
      notify.success(policy ? "Routing policy saved" : "Routing policy reset");
    } catch (err) {
      setError(err.message || "Failed to save routing policy");
    } finally {
      setSaving(false);
    }
  };

  const quantizations = routing.quantizations || [];
  const active = routing.zdr || quantizations.length > 0;
  const formats = [...new Set([...OPENROUTER_QUANTIZATIONS, "unknown", ...quantizations])];

  return (
    <Card padding="xs">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={`${id}-panel`}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[20px]">tune</span>
          <span className="text-sm font-semibold">OpenRouter Routing Policy</span>
          {active && <Badge variant="success" size="sm">Active</Badge>}
          {routing.zdr && (routing.allowImageWithoutZdr || routing.allowVideoWithoutZdr) && <Badge variant="warning" size="sm">ZDR exceptions</Badge>}
        </span>
        <span aria-hidden="true" className="material-symbols-outlined text-text-muted">{expanded ? "expand_less" : "expand_more"}</span>
      </button>

      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      {expanded && (
        <div id={`${id}-panel`} className="mt-3 space-y-4 border-t border-border pt-3">
          <p className="text-xs text-text-muted">
            Filters apply only to supported OpenRouter upstream routes, including the current TTS chat route. Upstream account restrictions still apply.
          </p>
          {!loaded && !error && <p role="status" className="text-sm text-text-muted">Loading routing policy...</p>}
          <fieldset disabled={!loaded || saving} className="space-y-4 disabled:opacity-50">
            <legend className="sr-only">OpenRouter routing settings</legend>
            <label className="flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" role="switch" checked={!!routing.zdr} onChange={(event) => setRouting((value) => ({ ...value, zdr: event.target.checked }))} className="accent-primary" />
              Require zero data retention (ZDR)
            </label>
            {routing.zdr && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="text-xs text-text-muted">Video generation is incompatible with ZDR. Image-generation ZDR enforcement is unverified. With an exception off, that generation is blocked under ZDR; turning it on allows generation without ZDR. Exceptions remain saved when ZDR is off.</p>
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" role="switch" checked={!!routing.allowImageWithoutZdr} onChange={(event) => setRouting((value) => ({ ...value, allowImageWithoutZdr: event.target.checked }))} className="accent-primary" />
                   Allow image generation without verified ZDR
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" role="switch" checked={!!routing.allowVideoWithoutZdr} onChange={(event) => setRouting((value) => ({ ...value, allowVideoWithoutZdr: event.target.checked }))} className="accent-primary" />
                  Allow video generation without ZDR
                </label>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor={`${id}-precision`} className="block text-sm font-medium">Precision filter</label>
              <select
                id={`${id}-precision`}
                value={preset}
                onChange={(event) => {
                  const value = event.target.value;
                  setPreset(value);
                  if (value !== "custom") setRouting((policy) => ({ ...policy, quantizations: [...OPENROUTER_PRECISION_PRESETS[value]] }));
                }}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="unrestricted">Unrestricted</option>
                <option value="eightBit">8-bit or higher</option>
                <option value="sixteenBit">16-bit or higher</option>
                <option value="custom">Custom</option>
              </select>
              <p className="text-xs text-text-muted">Allowed formats: {quantizations.length ? quantizations.join(", ") : "all formats (no precision filter)"}.</p>
              <p className="text-xs text-text-muted">Precision filtering applies to completion, embedding, and System One routes, including current TTS audio completions. Saved precision filters skip proprietary Claude, GPT, Gemini, and Grok 3+ models with undisclosed precision; explicit request filters still apply. Open-weight GPT-OSS, Gemma, and Grok 1 remain filtered. Dedicated image and video generation are not precision-filtered.</p>
              {preset === "custom" && (
                <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
                  <legend className="mb-2 text-xs text-text-muted">Select allowed formats. Unknown explicitly permits routes with unspecified precision.</legend>
                  {formats.map((format) => (
                    <label key={format} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={quantizations.includes(format)}
                        onChange={(event) => setRouting((policy) => ({ ...policy, quantizations: event.target.checked ? [...(policy.quantizations || []), format] : (policy.quantizations || []).filter((value) => value !== format) }))}
                        className="accent-primary"
                      />
                      {format === "unknown" ? "unknown (unspecified precision)" : format}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted">Reset clears routing only; custom headers are unchanged.</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" disabled={!loaded || saving} onClick={() => save(null)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03] disabled:opacity-50">Reset</button>
              <button type="button" disabled={!loaded || saving} onClick={() => save(routing)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

OpenRouterRoutingCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};

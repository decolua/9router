"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { ErrorReason } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatContextLength } from "@/shared/utils/importProviderModels";
import { refreshModelCaps } from "@/shared/hooks/useModelCaps";

const DEFAULT_BUTTON_CLASS = "rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary transition-colors";

// "Detect" action for one provider+model: POSTs /api/models/meta/detect
// (reads the provider's own model list for context window, probes one real
// small request for reasoning), then refreshes the shared model-caps cache
// (useModelCaps) so the context/reasoning chips update without a page reload.
// Shared across ModelRow / CompatibleModelRow / PassthroughModelRow so the
// fetch + result/error panel isn't copy-pasted three times.
export default function DetectMetaButton({ providerId, modelId, buttonClassName = DEFAULT_BUTTON_CLASS }) {
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (status !== "done" && status !== "error") return undefined;
    const close = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setStatus("idle");
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setStatus("idle"); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [status]);

  const handleDetect = async (e) => {
    e.stopPropagation();
    if (status === "running") return;
    setStatus("running");
    setError(null);
    try {
      const res = await fetch("/api/models/meta/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, modelId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        setStatus("error");
        setError({ message: data?.error || `HTTP ${res.status}`, status: res.status });
        return;
      }
      await refreshModelCaps();
      setResult(data);
      if (data.probe?.error) {
        setStatus("error");
        setError({ message: data.probe.error, status: data.probe.status });
      } else {
        setStatus("done");
      }
    } catch (err) {
      setStatus("error");
      setError({ message: err?.message || "Network error", status: null });
    }
  };

  const summaryText = () => {
    if (!result) return "";
    const parts = [];
    if (result.contextWindow) parts.push(`${translate("Context")}: ${formatContextLength(result.contextWindow)}`);
    if (typeof result.reasoning === "boolean") {
      parts.push(`${translate("Reasoning")}: ${result.reasoning ? translate("Yes") : translate("No")}`);
    }
    return parts.length ? parts.join(" · ") : translate("No new data found");
  };

  return (
    <span className="relative inline-flex shrink-0" ref={rootRef}>
      <div className="relative group/btn">
        <button
          type="button"
          onClick={handleDetect}
          disabled={status === "running"}
          className={buttonClassName}
        >
          <span
            className="material-symbols-outlined text-[17px]"
            style={status === "running" ? { animation: "spin 1s linear infinite" } : undefined}
          >
            {status === "running" ? "progress_activity" : "troubleshoot"}
          </span>
        </button>
        <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap text-[10px] text-text-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
          {status === "running" ? translate("Detecting...") : translate("Detect context and reasoning")}
        </span>
      </div>

      {(status === "done" || status === "error") && (
        // Opens leftwards: the button sits at the row's right edge.
        <div className="absolute right-0 top-full z-40 mt-1 w-60 max-w-[80vw] rounded-lg border border-border bg-surface p-2 shadow-2xl">
          <p className="mb-1 text-[11px] font-semibold text-text-main">{translate("Detection result")}</p>
          {status === "error" && result?.contextWindow ? (
            <p className="mb-1 text-[11px] text-text-muted">
              {translate("Context")}: {formatContextLength(result.contextWindow)}
            </p>
          ) : null}
          {status === "error" ? (
            <ErrorReason error={error?.message} status={error?.status} compact />
          ) : (
            <p className="text-[11px] text-text-muted">{summaryText()}</p>
          )}
        </div>
      )}
    </span>
  );
}

DetectMetaButton.propTypes = {
  providerId: PropTypes.string.isRequired,
  modelId: PropTypes.string.isRequired,
  buttonClassName: PropTypes.string,
};

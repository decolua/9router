"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

// Where one catalog entry comes from, in the same words the dashboard uses
// for the model pages.
function originLabel(entry) {
  switch (entry?.origin) {
    case "combo": return "Combo";
    case "studio": return "Studio";
    case "custom": return "Custom";
    default: return "Provider";
  }
}

// Short health of one entry, from the connection and lock state the server saw
// when it built the list. A colored dot plus text, using the same dot styles
// the usage tables already use.
function StatusPill({ status }) {
  const dot =
    status === "unavailable" ? "bg-error" :
    status === "cooldown" || status === "limited" ? "bg-amber-500" :
    "bg-success";
  const label =
    status === "unavailable" ? "Unavailable" :
    status === "cooldown" ? "Cooling down" :
    status === "limited" ? "Limited" :
    "Ready";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
      <span className={`block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/**
 * Models the signing-in key may call.
 *
 * Rendered only for an API key session (the parent checks the role first), so
 * an admin never sees it. The list itself comes from
 * GET /api/usage/available-models, which narrows the shared catalog to this
 * key's allowedModels before answering.
 */
export default function AvailableModelsCard({ visible }) {
  const [models, setModels] = useState(null);
  const [meta, setMeta] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    fetch("/api/usage/available-models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (!d || !Array.isArray(d.models)) {
          setFailed(true);
          return;
        }
        setModels(d.models);
        setMeta({ total: d.total, keyName: d.keyName });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible || failed) return null;

  const count = models ? models.length : null;
  const subtitle = meta && count !== null
    ? `${count} of ${meta.total} models available to ${meta.keyName || "this key"}`
    : "Loading the models this key may call";

  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            model_training
          </span>
          <span className="truncate text-sm font-semibold text-text-main">
            Available Models
          </span>
        </div>
        <span className="text-xs text-text-muted">{subtitle}</span>
      </div>

      {!models ? (
        <div className="flex items-center justify-center py-6 text-text-muted">
          <span className="material-symbols-outlined text-[24px] animate-spin">progress_activity</span>
        </div>
      ) : models.length === 0 ? (
        <div className="text-sm text-text-muted">No models are available to this key yet.</div>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {models.map((m) => (
            <li
              key={`${m.origin || "model"}:${m.fullModel || m.model}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface/40 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-xs text-text-main" title={m.routedModel || m.fullModel || m.model}>
                  {m.alias && m.alias !== m.model ? `${m.alias} (${m.model})` : m.model}
                </span>
                <span className="truncate text-[11px] text-text-muted">
                  {originLabel(m)}{m.provider && m.origin !== "combo" ? ` : ${m.provider}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill status={m.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

AvailableModelsCard.propTypes = {
  visible: PropTypes.bool,
};

AvailableModelsCard.defaultProps = {
  visible: false,
};

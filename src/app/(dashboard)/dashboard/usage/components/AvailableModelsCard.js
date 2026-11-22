"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

// Context window, in the compact form the model lists use elsewhere. A model
// the capability table does not know renders nothing rather than a guess.
function contextLabel(entry) {
  const win = Number(entry?.contextWindow);
  if (!Number.isFinite(win) || win <= 0) return null;
  if (win >= 1_000_000) return `${Math.round(win / 1_000_000)}M context`;
  if (win >= 1000) return `${Math.round(win / 1000)}K context`;
  return `${win} context`;
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
/**
 * Display name for one row.
 *
 * A bare model id that only one row carries reads best on its own. The same id
 * reachable through several provider connections would print the same string
 * several times - four rows all saying "minimax-m2" read as a bug (they did).
 * Those ambiguous rows show the provider so each one names the connection it
 * actually calls.
 */
function labelFor(entry, ambiguous) {
  const bare = String(entry.model || entry.name || "");
  if (!ambiguous) return bare;
  // routedModel is the address a request actually goes to, and it is unique
  // per connection - including when the model id already carries a vendor
  // prefix (`kc/openai/gpt-4.1` vs `openai/gpt-4.1`), which a hand-built
  // `provider/bare` prefix cannot disambiguate.
  const routed = String(entry.routedModel || entry.fullModel || "").trim();
  if (routed) return routed;
  const provider = String(entry.provider || "").trim();
  return provider ? `${provider}/${bare}` : bare;
}

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
  // A bare name reachable through more than one row must say which connection
  // it calls, or the list shows the same label several times over.
  const bareCounts = {};
  if (Array.isArray(models)) {
    for (const m of models) {
      const b = String(m.model || m.name || "");
      bareCounts[b] = (bareCounts[b] || 0) + 1;
    }
  }
  const subtitle = meta && count !== null
    ? `${count} of ${meta.total} models available to ${meta.keyName || "this key"}`
    : "Loading the models this key may call";

  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            dataset
          </span>
          <span className="truncate text-sm font-semibold text-text-main">
            Available Models
          </span>
        </div>
        <span className="text-xs text-text-muted">{subtitle}</span>
      </div>

      {!models ? (
        <div className="flex items-center justify-center py-6 text-text-muted">
          <span className="material-symbols-outlined text-[24px] animate-spin">autorenew</span>
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
                  {(() => { const amb = (bareCounts[String(m.model || m.name || "")] || 0) > 1; const label = labelFor(m, amb); return (m.alias && m.alias !== label) ? `${m.alias} (${label})` : label; })()}
                </span>
                {contextLabel(m) ? (
                  <span className="truncate text-[11px] text-text-muted">{contextLabel(m)}</span>
                ) : null}
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

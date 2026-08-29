"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyHealth } from "@/lib/modelControlCenter/health.js";

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const out = [];
  const workers = Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      out.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return out;
}

function healthBadge(model) {
  if (model.stale) {
    return {
      key: "stale",
      label: "STALE",
      cls: "text-amber-600 bg-amber-500/10",
    };
  }

  const category = classifyHealth(model.health);

  const badges = {
    ok: {
      key: "ok",
      label: "OK",
      cls: "text-green-600 bg-green-500/10",
    },
    timeout: {
      key: "timeout",
      label: "TIMEOUT",
      cls: "text-amber-600 bg-amber-500/10",
    },
    unavailable: {
      key: "unavailable",
      label: "UNAVAILABLE",
      cls: "text-text-muted bg-surface-2",
    },
    restricted: {
      key: "restricted",
      label: "RESTRICTED",
      cls: "text-amber-600 bg-amber-500/10",
    },
    rate_limited: {
      key: "rate_limited",
      label: "RATE LIMITED",
      cls: "text-amber-600 bg-amber-500/10",
    },
    upstream_error: {
      key: "upstream_error",
      label: "UPSTREAM",
      cls: "text-red-500 bg-red-500/10",
    },
    probe_incompatible: {
      key: "probe_incompatible",
      label: "PROBE INCOMPATIBLE",
      cls: "text-text-muted bg-surface-2",
    },
    failed: {
      key: "failed",
      label: "FAILED",
      cls: "text-red-500 bg-red-500/10",
    },
    unsupported: {
      key: "unsupported",
      label: "N/A",
      cls: "text-text-muted bg-surface-2",
    },
    pending: {
      key: "pending",
      label: "PENDING",
      cls: "text-text-muted bg-surface-2",
    },
  };

  return badges[category] || badges.pending;
}

async function loadEffectivePreview(signal) {
  const res = await fetch(
    "/api/models/control-center/effective",
    {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.error
      || "Failed to load effective model preview",
    );
  }

  return data;
}

async function loadPolicyDryRun(signal) {
  const res = await fetch(
    "/api/models/control-center/dry-run",
    {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.error
      || "Failed to load policy dry-run",
    );
  }

  return data;
}

function effectiveBadge(effective) {
  if (!effective) {
    return {
      label: "UNKNOWN",
      cls: "text-text-muted bg-surface-2",
    };
  }

  if (effective.effectivePreview) {
    return {
      label: "EFFECTIVE",
      cls: "text-green-600 bg-green-500/10",
    };
  }

  if (effective.operatorDisabled) {
    return {
      label: "OPERATOR DISABLED",
      cls: "text-red-500 bg-red-500/10",
    };
  }

  if (
    effective.reasons?.includes(
      "all_connections_model_locked",
    )
  ) {
    return {
      label: "MODEL LOCKED",
      cls: "text-amber-600 bg-amber-500/10",
    };
  }

  if (
    effective.reasons?.includes(
      "no_active_connection",
    )
  ) {
    return {
      label: "NO CONNECTION",
      cls: "text-text-muted bg-surface-2",
    };
  }

  if (effective.reasons?.includes("stale")) {
    return {
      label: "STALE",
      cls: "text-amber-600 bg-amber-500/10",
    };
  }

  return {
    label: "BLOCKED",
    cls: "text-red-500 bg-red-500/10",
  };
}

function dryRunBadge(direct) {
  if (!direct) {
    return {
      label: "UNKNOWN",
      cls: "text-text-muted bg-surface-2",
    };
  }

  const state =
    direct.operatorPolicy?.state
    || "default";

  if (direct.dryRun?.excluded) {
    return {
      label: "WOULD EXCLUDE",
      cls: "text-red-500 bg-red-500/10",
    };
  }

  if (state === "deprioritize") {
    return {
      label: "DIRECT N/A",
      cls: "text-amber-600 bg-amber-500/10",
    };
  }

  if (state === "allow") {
    return {
      label: "KEEP",
      cls: "text-green-600 bg-green-500/10",
    };
  }

  return {
    label: "NO CHANGE",
    cls: "text-text-muted bg-surface-2",
  };
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-2xl font-semibold text-text-main mt-1">{value ?? 0}</div>
    </div>
  );
}

export default function ModelControlCenterPage() {
  const [state, setState] = useState(null);
  const [effectiveState, setEffectiveState] = useState(null);
  const [dryRunState, setDryRunState] = useState(null);
  const [busy, setBusy] = useState("");
  const [policyBusy, setPolicyBusy] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/models/control-center", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load model control center");
        }
        return data;
      })
      .then((data) => {
        setState(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setMessage(error.message);
        }
      });

    loadEffectivePreview(controller.signal)
      .then((data) => {
        setEffectiveState(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setMessage(
            `Effective preview unavailable: ${error.message}`,
          );
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!effectiveState?.generatedAt) {
      return undefined;
    }

    const controller =
      new AbortController();

    loadPolicyDryRun(
      controller.signal,
    )
      .then((data) => {
        setDryRunState(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setMessage(
            `Policy dry-run unavailable: ${error.message}`,
          );
        }
      });

    return () =>
      controller.abort();
  }, [effectiveState]);

  const refreshEffectivePreview = () => {
    loadEffectivePreview()
      .then((data) => {
        setEffectiveState(data);
      })
      .catch(() => undefined);
  };

  const updateOperatorPolicy = async (
    provider,
    model,
    effective,
    nextState,
  ) => {
    if (policyBusy) return;

    const currentState =
      effective?.operatorPolicy?.state
      || (
        effective?.operatorDisabled
          ? "disable"
          : "default"
      );

    if (currentState === nextState) {
      return;
    }

    const providerAlias =
      provider.alias
      || provider.providerId;

    if (
      currentState === "disable"
      || nextState === "disable"
    ) {
      const confirmation =
        nextState === "disable"
          ? `Disable ${model.fullModel} using the existing disabledModels policy?`
          : `Remove ${model.fullModel} from the existing disabledModels policy and set ${nextState.toUpperCase()}?`;

      if (!window.confirm(confirmation)) {
        return;
      }
    }

    const key =
      `${provider.providerId}:${model.id}`;

    setPolicyBusy(key);

    try {
      const res = await fetch(
        "/api/models/control-center/policy",
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            providerAlias,
            modelId: model.id,
            state: nextState,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error
          || "Failed to update operator policy",
        );
      }

      const nextEffective =
        await loadEffectivePreview();

      setEffectiveState(nextEffective);

      const note =
        nextState === "disable"
          ? "Existing disabledModels semantics now apply."
          : "Policy persisted. Selector integration remains unchanged in Phase B.3.";

      setMessage(
        `Policy ${model.fullModel}: ${currentState.toUpperCase()} → ${nextState.toUpperCase()}. ${note}`,
      );
    } catch (error) {
      setMessage(
        `Policy update failed: ${error.message}`,
      );
    } finally {
      setPolicyBusy("");
    }
  };

  const refreshModels = async () => {
    if (busy) return;
    setBusy("refresh");
    setMessage("Resolving models from active provider connections...");
    try {
      const providersRes = await fetch("/api/providers", { cache: "no-store" });
      const providersData = await providersRes.json();
      if (!providersRes.ok) throw new Error(providersData.error || "Failed to load providers");

      const connections = (providersData.connections || []).filter((connection) => connection.isActive !== false);
      const discovery = await mapLimit(connections, 4, async (connection) => {
        try {
          const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/models`, {
            cache: "no-store",
            signal: AbortSignal.timeout(20000),
          });
          const data = await res.json().catch(() => ({}));
          return {
            connectionId: connection.id,
            provider: connection.provider,
            models: res.ok ? (data.models || []) : [],
            warning: res.ok ? (data.warning || null) : (data.error || `HTTP ${res.status}`),
          };
        } catch (error) {
          const timedOut =
            error?.name === "TimeoutError"
            || error?.name === "AbortError";

          return {
            connectionId: connection.id,
            provider: connection.provider,
            models: [],
            warning: timedOut
              ? "Model discovery timed out after 20s"
              : (error?.message || "Model discovery failed"),
          };
        }
      });

      const res = await fetch("/api/models/control-center/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discovery, syncCapabilities: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setState(data.state);
      refreshEffectivePreview();
      setMessage(`Refresh complete: ${data.state.summary.models} models across ${data.state.summary.providers} providers.`);
    } catch (error) {
      setMessage(`Refresh failed: ${error.message}`);
    } finally {
      setBusy("");
    }
  };

  const testModels = async (scope) => {
    if (busy) return;
    if (
      scope === "all"
      && !window.confirm(
        "This test batch can consume provider quota and may generate images. Continue?",
      )
    ) return;
    setBusy(
      scope === "changed"
        ? "test-changed"
        : scope === "transient"
          ? "test-transient"
          : "test-all",
    );

    setMessage(
      scope === "changed"
        ? "Testing changed models..."
        : scope === "transient"
          ? "Retrying transient failures..."
          : "Testing all testable models...",
    );
    try {
      const res = await fetch("/api/models/control-center/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          includeExpensive: scope === "all",
          ...(providerFilter !== "all"
            ? { provider: providerFilter }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Model test failed");
      setState(data.state);
      refreshEffectivePreview();
      const providerLabel =
        providerFilter !== "all"
          ? ` for ${providerFilter}`
          : "";

      const details = [
        `${data.tested} models tested${providerLabel}`,
        data.remainingChanged != null
          ? `${data.remainingChanged} changed remaining`
          : null,
        data.remainingPending != null
          ? `${data.remainingPending} pending`
          : null,
        data.remainingRetryable != null
          ? `${data.remainingRetryable} retryable remaining`
          : null,
        data.skippedCooldown
          ? `${data.skippedCooldown} cooling down`
          : null,
        data.skippedExpensive
          ? `${data.skippedExpensive} image probe(s) skipped`
          : null,
      ].filter(Boolean).join(" · ");

      setMessage(`Model test complete: ${details}.`);
    } catch (error) {
      setMessage(`Model test failed: ${error.message}`);
    } finally {
      setBusy("");
    }
  };

  const providerList = useMemo(
    () => Object.values(state?.providers || {}).sort((a, b) => a.name.localeCompare(b.name)),
    [state],
  );

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = [];

    for (const provider of providerList) {
      if (providerFilter !== "all" && provider.providerId !== providerFilter) continue;
      for (const model of Object.values(provider.models || {})) {
        const badge = healthBadge(model);
        if (healthFilter !== "all" && badge.key !== healthFilter) continue;
        if (query) {
          const haystack = `${provider.name} ${provider.providerId} ${model.id} ${model.name} ${model.fullModel}`.toLowerCase();
          if (!haystack.includes(query)) continue;
        }
        const effective =
          effectiveState
            ?.providers
            ?.[provider.providerId]
            ?.models
            ?.[model.id]
          || null;

        result.push({
          provider,
          model,
          badge,
          effective,
        });
      }
    }

    return result;
  }, [
    providerList,
    providerFilter,
    healthFilter,
    search,
    effectiveState,
  ]);

  const dryRunDirectByFullModel =
    useMemo(
      () =>
        new Map(
          (dryRunState?.direct || [])
            .map((item) => [
              item.fullModel,
              item,
            ]),
        ),
      [dryRunState],
    );

  const summary = state?.summary || {};

  const effectiveSummary =
    effectiveState?.summary || {};

  const dryRunSummary =
    dryRunState?.summary || {};

  const dryRunCombos =
    dryRunState?.combos || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Model Control Center</h1>
          <p className="text-sm text-text-muted mt-1">
            Global model discovery, runtime catalog, availability, and health monitoring.
          </p>
          <p className="text-xs text-text-muted mt-2">
            Last refresh: {state?.syncedAt ? new Date(state.syncedAt).toLocaleString() : "Never"}
            {" · "}
            Last test: {state?.testedAt ? new Date(state.testedAt).toLocaleString() : "Never"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={refreshModels}
            disabled={!!busy}
            className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
          >
            {busy === "refresh" ? "Refreshing..." : "Refresh Models"}
          </button>
          <button
            onClick={() => testModels("changed")}
            disabled={!!busy}
            className="px-3 py-2 rounded-lg border border-border bg-background text-text-main text-sm font-medium disabled:opacity-50"
          >
            {busy === "test-changed" ? "Testing..." : "Test Changed"}
          </button>
          <button
            onClick={() => testModels("transient")}
            disabled={!!busy || (state?.summary?.retryable || 0) === 0}
            className="px-3 py-2 rounded-lg border border-border bg-background text-text-main text-sm font-medium disabled:opacity-50"
          >
            {busy === "test-transient" ? "Testing..." : "Retry Transient"}
          </button>
          <button
            onClick={() => testModels("all")}
            disabled={!!busy}
            className="px-3 py-2 rounded-lg border border-border bg-background text-text-main text-sm font-medium disabled:opacity-50"
          >
            {busy === "test-all" ? "Testing..." : "Test Next Batch"}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-text-muted">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-10 gap-3">
        <SummaryCard label="Providers" value={summary.providers} />
        <SummaryCard label="Connections" value={summary.connections} />
        <SummaryCard label="Models" value={summary.models} />
        <SummaryCard label="Healthy" value={summary.healthy} />
        <SummaryCard label="Failures" value={summary.failed} />
        <SummaryCard label="Retryable" value={summary.retryable} />
        <SummaryCard label="N/A" value={summary.unsupported} />
        <SummaryCard label="Pending" value={summary.pending} />
        <SummaryCard label="Changed" value={summary.changed} />
        <SummaryCard label="Stale" value={summary.stale} />
      </div>

      <div className="rounded-xl border border-border bg-background">
        <div className="p-4 border-b border-border flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-medium text-text-main">
              Effective Preview
            </div>
            <div className="text-xs text-text-muted mt-1">
              Read-only routing projection. Health remains a signal and does not change routing.
            </div>
          </div>

          <div className="text-[11px] text-text-muted">
            {effectiveState?.generatedAt
              ? `Generated ${new Date(effectiveState.generatedAt).toLocaleString()}`
              : "Loading preview..."}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 p-4">
          <SummaryCard
            label="Eligible"
            value={effectiveSummary.previewEligible}
          />
          <SummaryCard
            label="Blocked"
            value={effectiveSummary.previewBlocked}
          />
          <SummaryCard
            label="Operator Disabled"
            value={effectiveSummary.operatorDisabled}
          />
          <SummaryCard
            label="Model Locked"
            value={effectiveSummary.allConnectionsLocked}
          />
          <SummaryCard
            label="Combo Quarantine"
            value={effectiveSummary.comboQuarantined}
          />
        </div>

        <div className="border-t border-border p-4">
          <div className="font-medium text-text-main">
            Operator Policy
          </div>
          <div className="text-xs text-text-muted mt-1">
            Persistent operator intent. DISABLE uses the existing disabledModels policy; ALLOW, DEPRIORITIZE, and QUARANTINE remain non-authoritative while Phase B.3 evaluates their routing impact.
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 px-4 pb-4">
          <SummaryCard
            label="Default"
            value={effectiveSummary.policyDefault}
          />
          <SummaryCard
            label="Allow"
            value={effectiveSummary.policyAllow}
          />
          <SummaryCard
            label="Deprioritize"
            value={effectiveSummary.policyDeprioritize}
          />
          <SummaryCard
            label="Quarantine"
            value={effectiveSummary.policyQuarantine}
          />
          <SummaryCard
            label="Disable"
            value={effectiveSummary.policyDisable}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background">
        <div className="p-4 border-b border-border flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-medium text-text-main">
              Policy Dry-run
            </div>

            <div className="text-xs text-text-muted mt-1">
              Simulated routing impact only. No selector or production routing changes are applied.
            </div>

            <div className="text-[11px] font-semibold text-amber-600 mt-2">
              DRY-RUN ONLY · ROUTING UNCHANGED · SELECTOR NOT INTEGRATED
            </div>
          </div>

          <div className="text-[11px] text-text-muted">
            {dryRunState?.generatedAt
              ? `Generated ${new Date(dryRunState.generatedAt).toLocaleString()}`
              : "Loading dry-run..."}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 p-4">
          <SummaryCard
            label="Direct Would Exclude"
            value={dryRunSummary.directWouldExclude}
          />

          <SummaryCard
            label="Combo Current Excluded"
            value={dryRunSummary.comboCurrentExcluded}
          />

          <SummaryCard
            label="Combo Dry-run Excluded"
            value={dryRunSummary.comboDryRunExcluded}
          />

          <SummaryCard
            label="Combo Deprioritized"
            value={dryRunSummary.comboDryRunDeprioritized}
          />

          <SummaryCard
            label="Combos"
            value={dryRunSummary.combos}
          />
        </div>

        <div className="border-t border-border px-4 py-3 text-xs text-text-muted">
          {dryRunSummary.models ?? 0} direct model projections
          {" · "}
          {dryRunSummary.comboMemberOccurrences ?? 0} configured combo member occurrences.
          Round-robin rank is intentionally not predicted.
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background">
        <div className="p-4 border-b border-border flex flex-col lg:flex-row gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search provider or model..."
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-main outline-none focus:border-primary"
          />
          <select
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-main"
          >
            <option value="all">All providers</option>
            {providerList.map((provider) => (
              <option key={provider.providerId} value={provider.providerId}>
                {provider.name}
              </option>
            ))}
          </select>
          <select
            value={healthFilter}
            onChange={(event) => setHealthFilter(event.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-main"
          >
            <option value="all">All health</option>
            <option value="ok">OK</option>
            <option value="timeout">Timeout</option>
            <option value="unavailable">Unavailable</option>
            <option value="restricted">Restricted</option>
            <option value="rate_limited">Rate Limited</option>
            <option value="upstream_error">Upstream Error</option>
            <option value="probe_incompatible">Probe Incompatible</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="stale">Stale</option>
            <option value="unsupported">N/A</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Availability</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 font-medium">Effective</th>
                <th className="px-4 py-3 font-medium">Dry-run</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ provider, model, badge, effective }) => (
                <tr key={`${provider.providerId}:${model.id}`} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-main">{provider.name}</div>
                    <div className="text-[11px] text-text-muted">{provider.connectionCount} connection(s)</div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-text-main">{model.fullModel}</code>
                    {model.name && model.name !== model.id && (
                      <div className="text-[11px] text-text-muted mt-1">{model.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{model.kind}</td>
                  <td className="px-4 py-3 text-text-muted">{model.source}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {model.availabilityKnown
                      ? `${model.connectionsAvailable}/${model.connectionCount}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded text-[11px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {model.health?.error && (
                      <div className="max-w-[280px] truncate text-[10px] text-red-500 mt-1" title={model.health.error}>
                        {model.health.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={
                        effective?.operatorPolicy?.state
                        || (
                          effective?.operatorDisabled
                            ? "disable"
                            : "default"
                        )
                      }
                      onChange={(event) =>
                        updateOperatorPolicy(
                          provider,
                          model,
                          effective,
                          event.target.value,
                        )
                      }
                      disabled={!!policyBusy}
                      title={
                        effective?.operatorPolicy?.source
                          ? `Source: ${effective.operatorPolicy.source}`
                          : "Operator policy"
                      }
                      className="min-w-[132px] px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-text-main disabled:opacity-50"
                    >
                      <option value="default">
                        DEFAULT
                      </option>
                      <option value="allow">
                        ALLOW
                      </option>
                      <option value="deprioritize">
                        DEPRIORITIZE
                      </option>
                      <option value="quarantine">
                        QUARANTINE
                      </option>
                      <option value="disable">
                        DISABLE
                      </option>
                    </select>

                    {effective?.operatorPolicy?.source && (
                      <div className="text-[10px] text-text-muted mt-1">
                        {effective.operatorPolicy.source}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {(() => {
                      const effectiveStatus =
                        effectiveBadge(effective);

                      return (
                        <>
                          <span
                            className={`inline-flex px-2 py-1 rounded text-[11px] font-semibold ${effectiveStatus.cls}`}
                            title={
                              effective?.reasons?.length
                                ? effective.reasons.join(", ")
                                : undefined
                            }
                          >
                            {effectiveStatus.label}
                          </span>

                          {effective?.signals?.length > 0 && (
                            <div
                              className="max-w-[260px] truncate text-[10px] text-text-muted mt-1"
                              title={effective.signals.join(", ")}
                            >
                              {effective.signals.join(" · ")}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>

                  <td className="px-4 py-3">
                    {(() => {
                      const direct =
                        dryRunDirectByFullModel.get(
                          model.fullModel,
                        );

                      const status =
                        dryRunBadge(direct);

                      const reason =
                        direct?.dryRun?.reasons
                          ?.join(", ")
                        || "No additional policy effect";

                      return (
                        <>
                          <span
                            className={`inline-flex px-2 py-1 rounded text-[11px] font-semibold ${status.cls}`}
                            title={reason}
                          >
                            {status.label}
                          </span>

                          {direct?.operatorPolicy?.state
                            && direct.operatorPolicy.state !== "default"
                            && (
                              <div className="text-[10px] text-text-muted mt-1">
                                policy:{direct.operatorPolicy.state}
                              </div>
                            )}
                        </>
                      );
                    })()}
                  </td>

                  <td className="px-4 py-3 text-text-muted">
                    {model.health?.latencyMs != null ? `${model.health.latencyMs} ms` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {model.changed ? (
                      <span className="text-amber-600 text-xs font-medium">YES</span>
                    ) : (
                      <span className="text-text-muted text-xs">NO</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-text-muted">
                    No models match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background">
        <div className="p-4 border-b border-border flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-medium text-text-main">
              Policy Dry-run — Combos
            </div>

            <div className="text-xs text-text-muted mt-1">
              Current candidate membership compared with the simulated policy candidate set.
            </div>
          </div>

          <div className="text-[11px] text-text-muted">
            {dryRunCombos.length} combo(s)
          </div>
        </div>

        {dryRunCombos.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-muted">
            No combos are configured.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
            {dryRunCombos.map((combo) => (
              <div
                key={combo.id || combo.name}
                className="rounded-xl border border-border bg-surface-1 p-4 min-w-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-text-main truncate">
                      {combo.name}
                    </div>

                    <div className="text-[11px] text-text-muted mt-1">
                      Strategy: {combo.strategy}
                      {" · "}
                      Order: {combo.orderMode}
                    </div>
                  </div>

                  <div className="text-[11px] text-text-muted whitespace-nowrap">
                    {combo.summary?.configuredMembers ?? 0} member(s)
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                  <SummaryCard
                    label="Current"
                    value={combo.summary?.currentCandidates}
                  />

                  <SummaryCard
                    label="Dry-run"
                    value={combo.summary?.dryRunCandidates}
                  />

                  <SummaryCard
                    label="Excluded"
                    value={combo.summary?.dryRunExcluded}
                  />

                  <SummaryCard
                    label="Deprioritized"
                    value={combo.summary?.dryRunDeprioritized}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">
                      Current
                    </div>

                    <div
                      className="text-xs text-text-main mt-1 truncate"
                      title={(combo.currentCandidates || []).join(" → ")}
                    >
                      {(combo.currentCandidates || []).join(" → ")
                        || "No current candidates"}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">
                      Dry-run
                    </div>

                    <div
                      className="text-xs text-text-main mt-1 truncate"
                      title={(combo.dryRunCandidates || []).join(" → ")}
                    >
                      {(combo.dryRunCandidates || []).join(" → ")
                        || "No dry-run candidates"}
                    </div>
                  </div>

                  {combo.orderMode === "rotation-dependent" && (
                    <div className="text-[11px] text-amber-600">
                      Round-robin order is rotation-dependent; policy effects shown here are relative only.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

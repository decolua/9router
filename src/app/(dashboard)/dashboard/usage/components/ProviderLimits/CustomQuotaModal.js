"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const DEFAULT_QUOTA = {
  name: "Quota",
  namePath: "",
  usedPath: "used",
  totalPath: "total",
  remainingPath: "",
  percentUsedPath: "",
  percentRemainingPath: "",
  unit: "",
  unitPath: "",
  resetAtPath: "resetAt",
  resetAtUnit: "auto",
  unlimitedPath: "",
  creditBalancePath: "",
  currency: "",
};

const RESET_UNITS = [
  { value: "auto", label: "Auto (ISO / epoch)" },
  { value: "unix", label: "Epoch seconds" },
  { value: "unix_ms", label: "Epoch milliseconds" },
  { value: "seconds_from_now", label: "Seconds from now" },
  { value: "minutes_from_now", label: "Minutes from now" },
];

function defaultConfig() {
  return {
    plan: "Custom",
    itemsPath: "",
    request: {
      url: "",
      method: "GET",
      headers: [{ name: "Authorization", value: "Bearer {{apiKey}}" }],
      body: "",
    },
    quotas: [{ ...DEFAULT_QUOTA }],
  };
}

function headersToText(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map((header) => `${header?.name || ""}: ${header?.value || ""}`.trim())
    .join("\n");
}

function textToHeaders(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return null;
      return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    })
    .filter((header) => header && header.name);
}

function configToForm(config) {
  if (!config) return defaultConfig();
  return {
    plan: config.plan || "Custom",
    itemsPath: config.itemsPath || "",
    request: {
      url: config.request?.url || "",
      method: config.request?.method || "GET",
      headers: config.request?.headers?.length ? config.request.headers : defaultConfig().request.headers,
      body: config.request?.body || "",
    },
    quotas: (config.quotas || []).map((row) => ({ ...DEFAULT_QUOTA, ...row })),
  };
}

function formToConfig(form) {
  return {
    enabled: true,
    plan: form.plan.trim() || "Custom",
    itemsPath: form.itemsPath.trim(),
    request: {
      url: form.request.url.trim(),
      method: form.request.method,
      headers: form.request.headers,
      body: form.request.method === "POST" ? form.request.body : "",
    },
    quotas: form.quotas.map((row) => {
      const next = { name: row.name.trim() };
      for (const key of Object.keys(DEFAULT_QUOTA)) {
        if (key === "name") continue;
        const value = typeof row[key] === "string" ? row[key].trim() : row[key];
        if (value !== "" && value != null) next[key] = value;
      }
      return next;
    }),
  };
}

function providerTitle(provider = "") {
  const custom = provider.replace(/^openai-compatible-?/, "");
  return custom || provider || "Provider";
}

function connectionLabel(connection) {
  return connection.name || connection.displayName || connection.email || connection.id;
}

export default function CustomQuotaModal({ isOpen, onClose, connection = null, onSaved }) {
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState(connection?.id || "");
  const [form, setForm] = useState(defaultConfig);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);
  const [hasSavedConfig, setHasSavedConfig] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    fetch("/api/providers/client?includeUnsupported=1&pageSize=500&page=1&sort=priority", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setConnections(data.connections || []);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !connectionId) return;

    let cancelled = false;
    const load = async () => {
      setLoadingConfig(true);
      setError(null);
      setTestResult(null);
      try {
        const response = await fetch(`/api/quota/custom?connectionId=${encodeURIComponent(connectionId)}`, { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        setHasSavedConfig(Boolean(data.config));
        setForm(configToForm(data.config));
      } catch {
        if (!cancelled) setForm(defaultConfig());
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId]);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === connectionId) || connection,
    [connections, connectionId, connection],
  );

  const updateRequest = (patch) => setForm((prev) => ({ ...prev, request: { ...prev.request, ...patch } }));
  const updateQuota = (index, patch) => setForm((prev) => ({
    ...prev,
    quotas: prev.quotas.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
  }));

  const addQuota = () => setForm((prev) => ({ ...prev, quotas: [...prev.quotas, { ...DEFAULT_QUOTA, name: `Quota ${prev.quotas.length + 1}` }] }));
  const removeQuota = (index) => setForm((prev) => ({ ...prev, quotas: prev.quotas.filter((_, rowIndex) => rowIndex !== index) }));

  const handleTest = async () => {
    if (!connectionId) {
      setError("Select a connection first.");
      return;
    }
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/quota/custom/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, config: formToConfig(form) }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Test request failed.");
      } else {
        setTestResult(data);
      }
    } catch (requestError) {
      setError(requestError.message || "Test request failed.");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!connectionId) {
      setError("Select a connection first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/quota/custom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, config: formToConfig(form) }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Could not save the quota source.");
        return;
      }
      setHasSavedConfig(true);
      if (onSaved) {
        await onSaved({ connectionId, provider: selectedConnection?.provider });
      }
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Could not save the quota source.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!connectionId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/quota/custom?connectionId=${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not remove the quota source.");
        return;
      }
      setHasSavedConfig(false);
      setForm(defaultConfig());
      if (onSaved) await onSaved({ connectionId, provider: selectedConnection?.provider });
    } catch (deleteError) {
      setError(deleteError.message || "Could not remove the quota source.");
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = "w-full rounded-[8px] border border-black/10 bg-surface-2 px-2 py-1.5 text-xs text-text-main placeholder-text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Custom quota source"
      size="full"
      footer={
        <>
          {hasSavedConfig && (
            <Button variant="danger" onClick={handleDelete} disabled={saving || testing}>
              Remove
            </Button>
          )}
          <Button variant="secondary" onClick={handleTest} loading={testing} disabled={saving || !connectionId}>
            Test
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={testing || !connectionId}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <p className="text-sm text-text-muted">
          Map any provider usage response onto the quota tracker. Leave a path empty to skip that value.
          Paths use dots and brackets, e.g. <code className="font-mono text-xs">data.limits[*].percentUsed</code>.
          Use <code className="font-mono text-xs">{"{{apiKey}}"}</code> and <code className="font-mono text-xs">{"{{baseUrl}}"}</code> in URLs and headers.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-main">Connection</span>
            <select
              value={connectionId}
              onChange={(event) => {
                setConnectionId(event.target.value);
                if (!event.target.value) {
                  setForm(defaultConfig());
                  setHasSavedConfig(false);
                }
              }}
              className="h-9 rounded-[10px] border border-black/10 bg-surface-2 px-2 text-sm text-text-main dark:border-white/10"
            >
              <option value="">Select a connection</option>
              {connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {providerTitle(item.provider)} · {connectionLabel(item)}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Plan label"
            value={form.plan}
            onChange={(event) => setForm((prev) => ({ ...prev, plan: event.target.value }))}
            placeholder="Custom"
            inputClassName="h-9 text-sm"
          />
        </div>

        {loadingConfig ? (
          <div className="py-6 text-center text-sm text-text-muted">Loading saved source…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <Input
                label="Request URL"
                value={form.request.url}
                onChange={(event) => updateRequest({ url: event.target.value })}
                placeholder="https://api.provider.com/v1/usage"
                inputClassName="h-9 font-mono text-sm"
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">Method</span>
                <select
                  value={form.request.method}
                  onChange={(event) => updateRequest({ method: event.target.value })}
                  className="h-9 rounded-[10px] border border-black/10 bg-surface-2 px-2 text-sm text-text-main dark:border-white/10"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">Headers (one per line)</span>
                <textarea
                  rows={3}
                  value={headersToText(form.request.headers)}
                  onChange={(event) => updateRequest({ headers: textToHeaders(event.target.value) })}
                  placeholder={"Authorization: Bearer {{apiKey}}\nAccept: application/json"}
                  className={cn(fieldClass, "font-mono")}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">
                  Body {form.request.method === "POST" ? "(JSON)" : "(POST only)"}
                </span>
                <textarea
                  rows={3}
                  value={form.request.body}
                  onChange={(event) => updateRequest({ body: event.target.value })}
                  disabled={form.request.method !== "POST"}
                  placeholder='{"accountId": "{{connectionId}}"}'
                  className={cn(fieldClass, "font-mono disabled:opacity-50")}
                />
              </label>
            </div>

            <Input
              label="Items path (optional, one row per array item)"
              value={form.itemsPath}
              onChange={(event) => setForm((prev) => ({ ...prev, itemsPath: event.target.value }))}
              placeholder="data.limits[*]"
              inputClassName="h-9 font-mono text-sm"
            />

            <div className="flex flex-col gap-3">
              {form.quotas.map((row, index) => (
                <div key={index} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quota {index + 1}</span>
                    {form.quotas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuota(index)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Name</span>
                      <input value={row.name} onChange={(event) => updateQuota(index, { name: event.target.value })} className={fieldClass} placeholder="Monthly tokens" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Name path</span>
                      <input value={row.namePath} onChange={(event) => updateQuota(index, { namePath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="type" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Used path</span>
                      <input value={row.usedPath} onChange={(event) => updateQuota(index, { usedPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="used" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Total path</span>
                      <input value={row.totalPath} onChange={(event) => updateQuota(index, { totalPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="limit" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Remaining path</span>
                      <input value={row.remainingPath} onChange={(event) => updateQuota(index, { remainingPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="remaining" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">% used path</span>
                      <input value={row.percentUsedPath} onChange={(event) => updateQuota(index, { percentUsedPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="percentUsed" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">% remaining path</span>
                      <input value={row.percentRemainingPath} onChange={(event) => updateQuota(index, { percentRemainingPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="percentRemaining" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Unit</span>
                      <input value={row.unit} onChange={(event) => updateQuota(index, { unit: event.target.value })} className={fieldClass} placeholder="tokens" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Unit path</span>
                      <input value={row.unitPath} onChange={(event) => updateQuota(index, { unitPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="unit" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Reset at path</span>
                      <input value={row.resetAtPath} onChange={(event) => updateQuota(index, { resetAtPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="resetsAt" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Reset format</span>
                      <select value={row.resetAtUnit} onChange={(event) => updateQuota(index, { resetAtUnit: event.target.value })} className={fieldClass}>
                        {RESET_UNITS.map((unit) => (
                          <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Unlimited path</span>
                      <input value={row.unlimitedPath} onChange={(event) => updateQuota(index, { unlimitedPath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="unlimited" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Credit balance path</span>
                      <input value={row.creditBalancePath} onChange={(event) => updateQuota(index, { creditBalancePath: event.target.value })} className={cn(fieldClass, "font-mono")} placeholder="balance" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Currency</span>
                      <input value={row.currency} onChange={(event) => updateQuota(index, { currency: event.target.value })} className={fieldClass} placeholder="USD" />
                    </label>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addQuota}
                className="self-start rounded-lg border border-dashed border-black/20 px-3 py-1.5 text-xs text-text-muted hover:text-text-main dark:border-white/20"
              >
                + Add quota row
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {testResult && (
              <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Test result</p>
                {testResult.message && <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">{testResult.message}</p>}
                {testResult.quotas?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-text-main">
                    {testResult.quotas.map((quota, index) => (
                      <li key={`${quota.name}-${index}`} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{quota.name}</span>
                        <span className="text-text-muted">
                          {quota.used.toLocaleString()} / {quota.total > 0 ? quota.total.toLocaleString() : "∞"}
                          {quota.unit ? ` ${quota.unit}` : ""} · {Math.round(quota.remaining)}% left
                          {quota.resetAt ? ` · resets ${new Date(quota.resetAt).toLocaleString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {testResult.raw && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/5 p-2 text-[11px] text-text-muted dark:bg-white/5">
                    {testResult.raw}
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

CustomQuotaModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connection: PropTypes.object,
  onSaved: PropTypes.func,
};

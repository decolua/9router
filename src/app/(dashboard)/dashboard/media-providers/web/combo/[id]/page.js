"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button, Input, Toggle, Modal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

const KIND_LABELS = {
  webSearch: "Web Search",
  webFetch: "Web Fetch",
};

const EXAMPLE_PATHS = {
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
};

const EXAMPLE_BODIES = {
  webSearch: (comboName) => ({ model: comboName, query: "What is the latest news about AI?", search_type: "web", max_results: 5 }),
  webFetch: (comboName) => ({ model: comboName, url: "https://example.com", format: "markdown" }),
};

function ProviderPickerModal({ isOpen, onClose, onPick, kind, currentIds, connections }) {
  // Only show providers with at least one usable connection (active/success) or noAuth
  const usableIds = new Set(
    (connections || [])
      .filter((c) => {
        if (c.isActive === false) return false;
        const s = c.testStatus;
        return s === "active" || s === "success" || s === "unavailable";
      })
      .map((c) => c.provider)
  );
  const all = kind ? getProvidersByKind(kind) : [];
  const providers = all.filter((p) => p.noAuth || usableIds.has(p.id));
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Add ${KIND_LABELS[kind] || ""} Provider`} size="md">
      {providers.length === 0 ? (
        <div className="text-center py-6 text-sm text-text-muted">
          No connected providers available. Add a connection first in the {KIND_LABELS[kind]} section.
        </div>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
        {providers.map((p) => {
          const already = currentIds.includes(p.id);
          return (
            <button
              key={p.id}
              disabled={already}
              onClick={() => { onPick(p.id); onClose(); }}
              className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                already
                  ? "border-border opacity-40 cursor-not-allowed"
                  : "border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
              }`}
            >
              <ProviderIcon
                src={`/providers/${p.id}.png`}
                alt={p.name}
                size={24}
                className="object-contain rounded shrink-0"
                fallbackText={p.textIcon || p.id.slice(0, 2).toUpperCase()}
                fallbackColor={p.color}
              />
              <span className="text-xs font-medium truncate text-left">{p.name}</span>
              {already && <span className="text-[9px] text-text-muted ml-auto">added</span>}
            </button>
          );
        })}
      </div>
      )}
    </Modal>
  );
}

export default function ComboDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [combo, setCombo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [providers, setProviders] = useState([]);
  const [roundRobin, setRoundRobin] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [logs, setLogs] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connections, setConnections] = useState([]);

  const fetchAll = async () => {
    try {
      const [comboRes, settingsRes, logsRes, keysRes, connsRes] = await Promise.all([
        fetch(`/api/combos/${id}`, { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/usage/logs", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      if (keysRes.ok) {
        const k = await keysRes.json();
        setApiKey((k.keys || []).find((x) => x.isActive !== false)?.key || "");
      }
      if (connsRes.ok) setConnections((await connsRes.json()).connections || []);
      if (!comboRes.ok) { setCombo(null); setLoading(false); return; }
      const c = await comboRes.json();
      setCombo(c);
      setName(c.name);
      setProviders(c.models || []);
      const s = settingsRes.ok ? await settingsRes.json() : {};
      setRoundRobin(s.comboStrategies?.[c.name]?.fallbackStrategy === "round-robin");
      const allLogs = logsRes.ok ? await logsRes.json() : [];
      setLogs(allLogs.filter((l) => typeof l === "string" && l.includes(c.name)).slice(0, 50));
    } catch { /* noop */ }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateName = (v) => {
    if (!v.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(v)) { setNameError("Only letters, numbers, -, _ and ."); return false; }
    setNameError("");
    return true;
  };

  const saveCombo = async (patch) => {
    const res = await fetch(`/api/combos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to save"); return false; }
    return true;
  };

  const handleSaveName = async () => {
    if (!validateName(name)) return;
    if (name === combo.name) return;
    const ok = await saveCombo({ name });
    if (ok) await fetchAll();
  };

  const handleAddProvider = async (providerId) => {
    const next = [...providers, providerId];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleRemoveProvider = async (idx) => {
    const next = providers.filter((_, i) => i !== idx);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleMove = async (idx, dir) => {
    const next = [...providers];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleToggleRoundRobin = async (enabled) => {
    setRoundRobin(enabled);
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const s = settingsRes.ok ? await settingsRes.json() : {};
    const updated = { ...(s.comboStrategies || {}) };
    if (enabled) updated[combo.name] = { fallbackStrategy: "round-robin" };
    else delete updated[combo.name];
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated }),
    });
  };

  const handleDelete = async () => {
    if (!confirm(`Delete combo "${combo.name}"?`)) return;
    const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/dashboard/media-providers/web");
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const path = EXAMPLE_PATHS[combo.kind];
      const body = EXAMPLE_BODIES[combo.kind](combo.name);
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      setTestResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setTestResult(`Error: ${e.message}`);
    }
    setTesting(false);
  };

  if (loading) return <div className="text-text-muted text-sm">Loading...</div>;
  if (!combo) return notFound();

  const kindLabel = KIND_LABELS[combo.kind] || "Web";
  const examplePath = EXAMPLE_PATHS[combo.kind];
  const exampleBody = combo.kind ? EXAMPLE_BODIES[combo.kind](combo.name) : null;
  const curlExample = examplePath
    ? `curl -X POST http://localhost:20128${examplePath} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\\n  -d '${JSON.stringify(exampleBody)}'`
    : "";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/media-providers/web" className="text-text-muted hover:text-primary">
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary">layers</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-text-muted">{kindLabel} Combo</p>
            <code className="text-lg font-semibold font-mono">{combo.name}</code>
          </div>
        </div>
        <Button variant="outline" icon="delete" onClick={handleDelete} className="text-red-500 border-red-200 hover:bg-red-50">
          Delete
        </Button>
      </div>

      {/* Settings Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Settings</h2>
        <div className="flex flex-col gap-4">
          <div>
            <Input label="Combo Name" value={name} onChange={(e) => { setName(e.target.value); validateName(e.target.value); }} onBlur={handleSaveName} error={nameError} />
            <p className="text-[10px] text-text-muted mt-0.5">Only letters, numbers, -, _ and .</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Round Robin</p>
              <p className="text-xs text-text-muted">Rotate providers across requests instead of strict fallback order.</p>
            </div>
            <Toggle checked={roundRobin} onChange={handleToggleRoundRobin} />
          </div>
        </div>
      </Card>

      {/* Providers Card */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Providers</h2>
            <p className="text-xs text-text-muted">Tried in order (top-down) or rotated when round-robin is on.</p>
          </div>
          <Button size="sm" icon="add" onClick={() => setShowPicker(true)}>Add Provider</Button>
        </div>
        {providers.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-border rounded-lg text-text-muted text-sm">
            No providers yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {providers.map((pid, idx) => {
              const p = AI_PROVIDERS[pid];
              return (
                <div key={`${pid}-${idx}`} className="flex items-center gap-3 p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02]">
                  <span className="text-xs text-text-muted w-5 text-center">{idx + 1}</span>
                  <ProviderIcon
                    src={`/providers/${pid}.png`}
                    alt={p?.name || pid}
                    size={24}
                    className="object-contain rounded shrink-0"
                    fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                    fallbackColor={p?.color}
                  />
                  <span className="text-sm font-medium flex-1 truncate">{p?.name || pid}</span>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => handleMove(idx, -1)} disabled={idx === 0} className={`p-1 rounded ${idx === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary hover:bg-black/5"}`} title="Move up">
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                    <button onClick={() => handleMove(idx, 1)} disabled={idx === providers.length - 1} className={`p-1 rounded ${idx === providers.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary hover:bg-black/5"}`} title="Move down">
                      <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                    </button>
                    <button onClick={() => handleRemoveProvider(idx)} className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10" title="Remove">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Test Example Card */}
      {combo.kind && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Test Example</h2>
            <Button size="sm" icon="play_arrow" onClick={handleTest} disabled={testing || providers.length === 0}>
              {testing ? "Running..." : "Run"}
            </Button>
          </div>
          <pre className="text-xs font-mono bg-black/[0.03] dark:bg-white/[0.03] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
            {curlExample}
          </pre>
          {testResult && (
            <pre className="mt-3 text-xs font-mono bg-black/[0.03] dark:bg-white/[0.03] p-3 rounded-lg overflow-auto max-h-[300px]">
              {testResult}
            </pre>
          )}
        </Card>
      )}

      {/* Usage Logs Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Usage Logs</h2>
        {logs.length === 0 ? (
          <p className="text-xs text-text-muted italic">No usage yet.</p>
        ) : (
          <pre className="text-[11px] font-mono bg-black/[0.03] dark:bg-white/[0.03] p-3 rounded-lg overflow-auto max-h-[400px] whitespace-pre-wrap">
            {logs.join("\n")}
          </pre>
        )}
      </Card>

      <ProviderPickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onPick={handleAddProvider}
        kind={combo.kind}
        currentIds={providers}
        connections={connections}
      />
    </div>
  );
}

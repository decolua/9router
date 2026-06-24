"use client";

import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import type { ComponentType, ChangeEvent, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import Link from "next/link";
import {
  Card as _Card,
  Button as _Button,
  Input as _Input,
  Toggle as _Toggle,
  ModelSelectModal as _ModelSelectModal,
} from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import type { JsonValue } from "open-sse/types/executor.js";

// ---------------------------------------------------------------------------
// Typed shims — JS shared components lack TS declarations
// ---------------------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  fullWidth?: boolean;
}
interface CardProps {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: string;
  action?: ReactNode;
  padding?: string;
  hover?: boolean;
  elev?: boolean;
  className?: string;
}
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  hint?: ReactNode;
  icon?: string;
  inputClassName?: string;
  type?: string;
}
interface ToggleProps {
  checked?: boolean;
  onChange?: (enabled: boolean) => void | Promise<void>;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: string;
  className?: string;
  title?: string;
}
interface ModelPickItem {
  value: string;
  name?: string;
  [key: string]: JsonValue | undefined;
}
interface ModelSelectModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSelect?: (model: ModelPickItem) => void;
  onDeselect?: (model: ModelPickItem) => void;
  activeProviders?: Connection[];
  modelAliases?: Record<string, string>;
  title?: string;
  kindFilter?: string | null;
  addedModelValues?: string[];
  closeOnSelect?: boolean;
}

const Button           = _Button           as ComponentType<ButtonProps>;
const Card             = _Card             as ComponentType<CardProps>;
const Input            = _Input            as ComponentType<InputProps>;
const Toggle           = _Toggle           as ComponentType<ToggleProps>;
const ModelSelectModal = _ModelSelectModal as ComponentType<ModelSelectModalProps>;

// ---------------------------------------------------------------------------
// JsonValue helpers
// ---------------------------------------------------------------------------
async function asJson(res: Response): Promise<JsonValue> {
  return res.json() as Promise<JsonValue>;
}
function strOf(v: JsonValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function recOf(v: JsonValue): Record<string, JsonValue> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, JsonValue>)
    : {};
}
function arrOf(v: JsonValue): JsonValue[] {
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
interface Combo {
  id: string;
  name: string;
  kind: string;
  models: string[];
}

interface Connection {
  id?: string;
  name?: string;
  [key: string]: JsonValue | undefined;
}

interface TestResult {
  json?: string;
  imageUrl?: string;
  audioUrl?: string;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse "providerId/model" or just "providerId" → { providerId, model }
function parseModelEntry(entry: string): { providerId: string; model: string } {
  const idx = entry.indexOf("/");
  if (idx < 0) return { providerId: entry, model: "" };
  return { providerId: entry.slice(0, idx), model: entry.slice(idx + 1) };
}

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

function nowAsync(): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  setTimeout(() => resolve(Date.now()), 0);
  return promise;
}

const KIND_LABELS: Record<string, string> = {
  webSearch: "Web Search",
  webFetch: "Web Fetch",
  image: "Text to Image",
  tts: "Text To Speech",
};

const EXAMPLE_PATHS: Record<string, string> = {
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
};

const EXAMPLE_BODIES: Record<string, (name: string) => Record<string, JsonValue>> = {
  webSearch: (n) => ({ model: n, query: "What is the latest news about AI?", search_type: "web", max_results: 5 }),
  webFetch:  (n) => ({ model: n, url: "https://example.com", format: "markdown" }),
  image:     (n) => ({ model: n, prompt: "A cute cat playing piano", n: 1, size: "1024x1024" }),
  tts:       (n) => ({ model: n, input: "Hello, this is a test.", voice: "alloy" }),
};

// Map combo.kind → listing route to go back to
function getListingHref(kind: string): string {
  if (kind === "webSearch" || kind === "webFetch") return "/dashboard/media-providers/web";
  return `/dashboard/media-providers/${kind}`;
}

// Mask large b64_json strings to keep JSON view readable
function maskB64(obj: JsonValue): JsonValue {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskB64);
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj as Record<string, JsonValue>)) {
    out[k] = k === "b64_json" && typeof v === "string" && v.length > 100
      ? `<${v.length} chars base64>`
      : maskB64(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
interface PageProps { params: Promise<{ id: string }> }

export default function ComboDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [combo, setCombo] = useState<Combo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [roundRobin, setRoundRobin] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});

  const fetchAll = async () => {
    try {
      const [comboRes, settingsRes, logsRes, keysRes, connsRes, aliasesRes] = await Promise.all([
        fetch(`/api/combos/${id}`, { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/usage/logs", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/models/alias", { cache: "no-store" }),
      ]);
      if (aliasesRes.ok) {
        const ar = recOf(await asJson(aliasesRes));
        const aliases = ar["aliases"];
        setModelAliases(aliases && typeof aliases === "object" && !Array.isArray(aliases)
          ? (aliases as Record<string, string>)
          : {});
      }
      if (keysRes.ok) {
        const kr = recOf(await asJson(keysRes));
        const key = arrOf(kr["keys"] ?? []).find((x) => {
          if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
          return (x as Record<string, JsonValue>)["isActive"] !== false;
        });
        setApiKey(key && typeof key === "object" && !Array.isArray(key)
          ? (strOf((key as Record<string, JsonValue>)["key"]) ?? "")
          : "");
      }
      if (connsRes.ok) {
        const cr = recOf(await asJson(connsRes));
        setConnections(arrOf(cr["connections"] ?? []) as Connection[]);
      }
      if (!comboRes.ok) { setCombo(null); setLoading(false); return; }
      const c = recOf(await asJson(comboRes));
      const built: Combo = {
        id:     strOf(c["id"])   ?? "",
        name:   strOf(c["name"]) ?? "",
        kind:   strOf(c["kind"]) ?? "",
        models: arrOf(c["models"] ?? []).map((m) => strOf(m as JsonValue) ?? "").filter(Boolean),
      };
      setCombo(built);
      setName(built.name);
      setProviders(built.models);
      const s = settingsRes.ok ? recOf(await asJson(settingsRes)) : {};
      const strategies = s["comboStrategies"];
      const stratRec = strategies && typeof strategies === "object" && !Array.isArray(strategies)
        ? (strategies as Record<string, JsonValue>)
        : {};
      const comboStrat = stratRec[built.name];
      const comboStratRec = comboStrat && typeof comboStrat === "object" && !Array.isArray(comboStrat)
        ? (comboStrat as Record<string, JsonValue>)
        : {};
      setRoundRobin(strOf(comboStratRec["fallbackStrategy"]) === "round-robin");
      const allLogsRaw = logsRes.ok ? await asJson(logsRes) : [];
      const allLogs = Array.isArray(allLogsRaw)
        ? allLogsRaw.filter((l): l is string => typeof l === "string" && l.includes(built.name)).slice(0, 50)
        : [];
      setLogs(allLogs);
    } catch { /* noop */ }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateName = (v: string) => {
    if (!v.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(v)) { setNameError("Only letters, numbers, -, _ and ."); return false; }
    setNameError("");
    return true;
  };

  const saveCombo = async (patch: Record<string, JsonValue>): Promise<boolean> => {
    const res = await fetch(`/api/combos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = recOf(await asJson(res));
      alert(strOf(err["error"]) ?? "Failed to save");
      return false;
    }
    return true;
  };

  const handleSaveName = async () => {
    if (!combo) return;
    if (!validateName(name)) return;
    if (name === combo.name) return;
    const ok = await saveCombo({ name });
    if (ok) await fetchAll();
  };

  const handleAddModel = async (model: ModelPickItem) => {
    const value = model?.value ?? "";
    if (!value || providers.includes(value)) return;
    const next = [...providers, value];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleDeselectModel = async (model: ModelPickItem) => {
    const value = model?.value ?? "";
    if (!value || !providers.includes(value)) return;
    const next = providers.filter((p) => p !== value);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleRemoveProvider = async (idx: number) => {
    const next = providers.filter((_, i) => i !== idx);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleMove = async (idx: number, dir: number) => {
    const next = [...providers];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap] as string, next[idx] as string];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleToggleRoundRobin = async (enabled: boolean) => {
    if (!combo) return;
    setRoundRobin(enabled);
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const s = settingsRes.ok ? recOf(await asJson(settingsRes)) : {};
    const existing = s["comboStrategies"];
    const updated: Record<string, JsonValue> = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, JsonValue>) }
      : {};
    if (enabled) updated[combo.name] = { fallbackStrategy: "round-robin" };
    else delete updated[combo.name];
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated }),
    });
  };

  const handleDelete = async () => {
    if (!combo) return;
    if (!confirm(`Delete combo "${combo.name}"?`)) return;
    const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
    if (res.ok) router.push(getListingHref(combo.kind));
  };

  const handleTest = async () => {
    if (!combo) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    if (testResult?.audioUrl) { try { URL.revokeObjectURL(testResult.audioUrl); } catch {} }
    if (testResult?.imageUrl?.startsWith("blob:")) { try { URL.revokeObjectURL(testResult.imageUrl); } catch {} }
    const start = await nowAsync();
    try {
      const path = EXAMPLE_PATHS[combo.kind];
      const bodyFn = EXAMPLE_BODIES[combo.kind];
      const body = bodyFn ? bodyFn(combo.name) : {};
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const latencyMs = (await nowAsync()) - start;
      if (!res.ok) {
        const d = recOf(await asJson(res).catch(() => ({})));
        const msg = strOf(d["error"]) ?? `HTTP ${res.status}`;
        setTestError(msg);
        setTestResult({ json: JSON.stringify(d, null, 2), latencyMs });
        return;
      }
      const ctype = res.headers.get("content-type") ?? "";
      // Binary image
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        setTestResult({ imageUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // Binary audio
      if (ctype.startsWith("audio/") || ctype === "application/octet-stream") {
        const blob = await res.blob();
        setTestResult({ audioUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // JSON — could be image (data[0].b64_json/url) or generic
      const data = recOf(await asJson(res));
      const dataArr = arrOf(data["data"] ?? []);
      const first = dataArr[0];
      const firstRec = first && typeof first === "object" && !Array.isArray(first)
        ? (first as Record<string, JsonValue>)
        : {};
      const b64 = strOf(firstRec["b64_json"]);
      const imgUrl = b64
        ? `data:image/png;base64,${b64}`
        : (strOf(firstRec["url"]) ?? "");
      setTestResult({ json: JSON.stringify(maskB64(data), null, 2), imageUrl: imgUrl, latencyMs });
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Network error");
    }
    setTesting(false);
  };

  if (loading) return <div className="text-text-muted text-sm">Loading...</div>;
  if (!combo) return notFound();

  const kindLabel = KIND_LABELS[combo.kind] ?? MEDIA_PROVIDER_KINDS.find((k: { id: string; label: string }) => k.id === combo.kind)?.label ?? "Combo";
  const examplePath = EXAMPLE_PATHS[combo.kind];
  const exampleBodyFn = EXAMPLE_BODIES[combo.kind];
  const exampleBody = exampleBodyFn ? exampleBodyFn(combo.name) : null;
  const curlExample = examplePath
    ? `curl -X POST http://localhost:20128${examplePath} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\\n  -d '${JSON.stringify(exampleBody)}'`
    : "";
  const backHref = getListingHref(combo.kind);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={backHref} className="text-text-muted hover:text-primary">
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
            <Input
              label="Combo Name"
              value={name}
              onChange={(e) => { setName(e.target.value); validateName(e.target.value); }}
              onBlur={handleSaveName}
              error={nameError}
            />
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
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
            {providers.map((entry, idx) => {
              const { providerId, model } = parseModelEntry(entry);
              const p = (AI_PROVIDERS as Record<string, { name?: string; textIcon?: string; color?: string } | undefined>)[providerId];
              return (
                <div key={`${entry}-${idx}`} className="flex items-center gap-3 p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02]">
                  <span className="text-xs text-text-muted w-5 text-center">{idx + 1}</span>
                  <ProviderIcon
                    src={`/providers/${providerId}.png`}
                    alt={p?.name ?? providerId}
                    size={24}
                    className="object-contain rounded shrink-0"
                    fallbackText={p?.textIcon ?? providerId.slice(0, 2).toUpperCase()}
                    fallbackColor={p?.color}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{p?.name ?? providerId}</div>
                    {model && <code className="text-[10px] text-text-muted font-mono truncate block">{model}</code>}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      className={`p-1 rounded ${idx === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary hover:bg-black/5"}`}
                      title="Move up"
                    >
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === providers.length - 1}
                      className={`p-1 rounded ${idx === providers.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary hover:bg-black/5"}`}
                      title="Move down"
                    >
                      <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                    </button>
                    <button
                      onClick={() => handleRemoveProvider(idx)}
                      className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10"
                      title="Remove"
                    >
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
      {combo.kind && examplePath && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
            <h2 className="text-lg font-semibold">Test Example</h2>
            <Button size="sm" icon="play_arrow" onClick={handleTest} disabled={testing || providers.length === 0}>
              {testing ? "Running..." : "Run"}
            </Button>
          </div>
          <pre className="text-xs font-mono bg-black/[0.03] dark:bg-white/[0.03] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
            {curlExample}
          </pre>
          {testError && (
            <p className="mt-3 text-xs text-red-500 break-words">{testError}</p>
          )}
          {testResult && (
            <div className="mt-3 flex flex-col gap-3">
              {testResult.latencyMs != null && (
                <span className="text-[11px] text-text-muted">⚡ {testResult.latencyMs}ms</span>
              )}
              {testResult.imageUrl && (
                <div>
                  <div className="flex items-center justify-end mb-1.5">
                    <a href={testResult.imageUrl} download="image.png" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors">
                      <span className="material-symbols-outlined text-[14px]">download</span>
                      Download
                    </a>
                  </div>
                  <img src={testResult.imageUrl} alt="Generated" className="max-w-full rounded-lg border border-border" />
                </div>
              )}
              {testResult.audioUrl && (
                <div>
                  <div className="flex items-center justify-end mb-1.5">
                    <a href={testResult.audioUrl} download="speech.mp3" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors">
                      <span className="material-symbols-outlined text-[14px]">download</span>
                      Download
                    </a>
                  </div>
                  <audio controls src={testResult.audioUrl} className="w-full" />
                </div>
              )}
              {testResult.json && (
                <pre className="text-xs font-mono bg-black/[0.03] dark:bg-white/[0.03] p-3 rounded-lg overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
                  {testResult.json}
                </pre>
              )}
            </div>
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

      <ModelSelectModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        activeProviders={connections}
        modelAliases={modelAliases}
        title={`Add ${kindLabel} Model`}
        kindFilter={combo.kind}
        addedModelValues={providers}
        closeOnSelect={false}
      />
    </div>
  );
}

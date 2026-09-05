"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Toggle,
  Modal,
  ConfirmModal,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { isRecord } from "@/lib/mcp/gateway/guards";

const KIND_OPTIONS = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "npx", label: "npx" },
  { value: "python", label: "Python" },
  { value: "docker", label: "Docker" },
  { value: "command", label: "Command" },
];

const TRANSPORT_OPTIONS = [
  { value: "http", label: "http" },
  { value: "sse", label: "sse" },
  { value: "stdio", label: "stdio" },
];

function emptyInstance() {
  return { slug: "", title: "", kind: "http", transport: "http", url: "", command: "", args: "", env: "", headers: "", oauth: false, enabled: true };
}

function parseMaybeJson(s, fallback) {
  if (typeof s !== "string" || !s.trim()) return fallback;
  try { return JSON.parse(s); } catch { return s; }
}

function stringifyMaybe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return ""; }
}

function isServerInstance(value) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.slug === "string"
    && typeof value.kind === "string"
    && typeof value.transport === "string";
}

function parseMcpInstances(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isServerInstance).map((i) => ({
    id: i.id,
    slug: i.slug,
    title: typeof i.title === "string" ? i.title : "",
    kind: i.kind,
    transport: i.transport,
    url: typeof i.url === "string" ? i.url : "",
    command: typeof i.command === "string" ? i.command : "",
    args: i.args,
    env: i.env,
    headers: i.headers,
    oauth: !!i.oauth,
    enabled: i.enabled !== false,
  }));
}

function parseTestResult(value) {
  if (!isRecord(value)) return { ok: false, error: "Invalid test response" };
  return {
    loading: value.loading === true,
    ok: value.ok === true,
    error: typeof value.error === "string" ? value.error : undefined,
    toolCount: typeof value.toolCount === "number" ? value.toolCount : undefined,
    sample: Array.isArray(value.sample)
      ? value.sample.filter((s) => isRecord(s) && typeof s.name === "string")
      : undefined,
  };
}

function instanceToForm(instance) {
  return {
    id: instance.id,
    slug: instance.slug,
    title: instance.title,
    kind: instance.kind,
    transport: instance.transport,
    url: instance.url,
    command: instance.command,
    args: stringifyMaybe(instance.args),
    env: stringifyMaybe(instance.env),
    headers: stringifyMaybe(instance.headers),
    oauth: instance.oauth,
    enabled: instance.enabled,
  };
}

export default function McpGatewayServersPage() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [testResults, setTestResults] = useState({});
  const notify = useNotificationStore((s) => s.addNotification);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp-gateway/instances");
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok) notify({ type: "error", message: body.error || `Failed to load instances (${res.status})` });
      setInstances(parseMcpInstances(body.instances));
    } catch (e) {
      notify({ type: "error", message: (e instanceof Error ? e.message : "Failed to load MCP servers") });
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    Promise.resolve().then(() => reload());
  }, [reload]);

  async function saveInstance(form) {
    const payload = {
      ...form,
      args: parseMaybeJson(form.args, []),
      env: parseMaybeJson(form.env, {}),
      headers: parseMaybeJson(form.headers, {}),
    };
    const isNew = !form.id;
    const res = await fetch(
      isNew ? "/api/mcp-gateway/instances" : `/api/mcp-gateway/instances/${form.id}`,
      {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify({ type: "error", message: body.error || `save failed (${res.status})` });
      return false;
    }
    notify({ type: "success", message: isNew ? "Instance created" : "Instance updated" });
    setEditing(null);
    await reload();
    return true;
  }

  async function deleteInstance(id) {
    const res = await fetch(`/api/mcp-gateway/instances/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      notify({ type: "error", message: body.error || "delete failed" });
      return;
    }
    notify({ type: "success", message: "Instance deleted" });
    setConfirmDelete(null);
    await reload();
  }

  async function connectInstance(id) {
    try {
      const authRes = await fetch(`/api/mcp-gateway/oauth/${id}/authorize`);
      const authBody = await authRes.json().catch(() => ({}));
      if (!authRes.ok || !authBody.url) {
        notify({ type: "error", message: authBody.error || `authorize failed (${authRes.status})` });
        return;
      }
      const popup = typeof authBody.url === "string" ? window.open(authBody.url, "_blank", "noopener,noreferrer") : null;
      if (!popup) {
        notify({ type: "error", message: "popup blocked — allow popups for this site" });
        return;
      }
      const state = typeof authBody.state === "string" ? authBody.state : "";
      const startedAt = Date.now();
      const pollMs = 1500;
      const maxMs = 60_000;
      const tick = async () => {
        if (Date.now() - startedAt > maxMs) {
          notify({ type: "warning", message: "OAuth flow timed out — check the popup tab" });
          return;
        }
        try {
          const r = await fetch(`/api/mcp-gateway/oauth/${id}/status?state=${encodeURIComponent(state)}`);
          const b = await r.json();
          if (b.status === "complete") {
            notify({ type: "success", message: "Connected" });
            await reload();
            return;
          }
          if (b.status === "error") {
            notify({ type: "error", message: b.error || "OAuth failed" });
            await reload();
            return;
          }
        } catch { /* keep polling */ }
        setTimeout(tick, pollMs);
      };
      setTimeout(tick, pollMs);
    } catch (e) {
      notify({ type: "error", message: (e instanceof Error ? e.message : "OAuth error") });
    }
  }

  async function testInstance(id) {
    setTestResults((m) => ({ ...m, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/mcp-gateway/instances/${id}/test`, { method: "POST" });
      const body = await res.json();
      setTestResults((m) => ({ ...m, [id]: parseTestResult(body) }));
    } catch (e) {
      setTestResults((m) => ({ ...m, [id]: { ok: false, error: (e instanceof Error ? e.message : "test failed") } }));
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">MCP Servers</h1>
          <p className="text-sm text-text-muted mt-1">
            Register upstream MCP servers and expose them through one endpoint.
            Tools appear as <code className="px-1 rounded bg-surface-2">&lt;slug&gt;__&lt;toolName&gt;</code>.
          </p>
        </div>
        <Button icon="add" onClick={() => setEditing(emptyInstance())}>New instance</Button>
      </div>

      <Card title="Instances" subtitle={`${instances.length} registered`}>
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : instances.length === 0 ? (
          <p className="text-sm text-text-muted">No instances yet. Click &quot;New instance&quot; to add one.</p>
        ) : (
          <div className="space-y-2">
            {instances.map((i) => {
              const test = testResults[i.id];
              return (
                <div
                  key={i.id}
                  className="flex items-start gap-3 p-3 rounded-[10px] border border-border-subtle bg-surface-1"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-text-main">{i.slug}</span>
                      <Badge size="sm" variant="default">{i.kind}</Badge>
                      <Badge size="sm" variant="default">{i.transport}</Badge>
                      {i.oauth && <Badge size="sm" variant="info">oauth</Badge>}
                      {i.enabled ? (
                        <Badge size="sm" variant="success" dot>enabled</Badge>
                      ) : (
                        <Badge size="sm" variant="default" dot>disabled</Badge>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1 truncate">
                      {i.transport === "stdio" ? `${i.command} ${(Array.isArray(i.args) ? i.args : []).join(" ")}` : i.url}
                    </div>
                    {test && !test.loading && (
                      <div className="mt-2 text-xs">
                        {test.ok ? (
                          <span className="text-green-600 dark:text-green-400">
                            {test.toolCount} tools
                            {test.sample?.length ? ` — sample: ${test.sample.map((s) => s.name).join(", ")}` : ""}
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">test failed: {test.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" icon="play_arrow" onClick={() => testInstance(i.id)} loading={test?.loading ?? false}>Test</Button>
                    {i.oauth && <Button size="sm" variant="ghost" icon="login" onClick={() => connectInstance(i.id)}>Connect</Button>}
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(instanceToForm(i))}>Edit</Button>
                    <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(i)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {editing && (
        <InstanceEditModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={saveInstance}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteInstance(confirmDelete.id)}
        title="Delete instance?"
        message="All grants to this instance will also be removed."
      />
    </div>
  );
}

function InstanceEditModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ ...emptyInstance(), ...initial });
  const isHttpLike = form.transport === "http" || form.transport === "sse";

  function patch(p) { setForm((f) => ({ ...f, ...p })); }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={form.id ? "Edit instance" : "New instance"}
      size="lg"
      showTrafficLights
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} icon="save">Save</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Slug" required value={form.slug} onChange={(e) => patch({ slug: e.target.value.toLowerCase() })} placeholder="jira-acme" hint="lowercase, digits, dashes; 2-40 chars; no __" />
          <Input label="Title" value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Jira (Acme)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Kind" required value={form.kind} onChange={(e) => patch({ kind: e.target.value })} options={KIND_OPTIONS} />
          <Select label="Transport" value={form.transport} onChange={(e) => patch({ transport: e.target.value })} options={TRANSPORT_OPTIONS} />
        </div>

        {isHttpLike ? (
          <Input label="URL" required value={form.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
        ) : (
          <>
            <Input label="Command" required value={form.command} onChange={(e) => patch({ command: e.target.value })} placeholder="npx" />
            <Input label="Args (JSON array)" value={form.args} onChange={(e) => patch({ args: e.target.value })} hint='e.g. ["-y", "@browsermcp/mcp@latest"]' />
            <Input label="Env (JSON object)" value={form.env} onChange={(e) => patch({ env: e.target.value })} hint='e.g. {"API_KEY":"..."}' />
          </>
        )}

        {isHttpLike && (
          <Input label="Headers (JSON object)" value={form.headers} onChange={(e) => patch({ headers: e.target.value })} hint='merged into every request; cannot override Content-Type/Accept/mcp-*' />
        )}

        <div className="flex items-center gap-6 pt-1">
          <Toggle checked={form.oauth} onChange={(v) => patch({ oauth: v })} label="Requires OAuth" description="Instance needs an Authorization token from a browser login" />
          <Toggle checked={form.enabled} onChange={(v) => patch({ enabled: v })} label="Enabled" />
        </div>
      </div>
    </Modal>
  );
}

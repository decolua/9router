"use client";

import { useEffect, useState, useCallback } from "react";
import type { ComponentType, ChangeEvent, ReactNode } from "react";
import {
  Card as _Card,
  Badge as _Badge,
  Button as _Button,
  Input as _Input,
  Select as _Select,
  Toggle as _Toggle,
  Modal as _Modal,
  ConfirmModal,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import type { JsonValue } from "open-sse/types/executor.js";

// ---------------------------------------------------------------------------
// Typed shims — JS shared components lack TS declarations; cast once here
// so every call site in this file gets proper optional-prop checking.
// ---------------------------------------------------------------------------
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconRight?: string;
  loading?: boolean | undefined;
  fullWidth?: boolean;
}
interface BadgeProps {
  children?: ReactNode;
  variant?: string;
  size?: string;
  dot?: boolean;
  icon?: string;
  className?: string;
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
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  hint?: string;
  icon?: string;
  inputClassName?: string;
}
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  selectClassName?: string;
}
interface ToggleProps {
  checked?: boolean;
  onChange?: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: string;
  className?: string;
}
interface ModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: string;
  closeOnOverlay?: boolean;
  showTrafficLights?: boolean;
  className?: string;
}
const Button = _Button as ComponentType<ButtonProps>;
const Badge  = _Badge  as ComponentType<BadgeProps>;
const Card   = _Card   as ComponentType<CardProps>;
const Input  = _Input  as ComponentType<InputProps>;
const Select = _Select as ComponentType<SelectProps>;
const Toggle = _Toggle as ComponentType<ToggleProps>;
const Modal  = _Modal  as ComponentType<ModalProps>;

// ---------------------------------------------------------------------------
// Page-local API response shapes (defined here — not yet in open-sse types)
// ---------------------------------------------------------------------------

interface McpInstance {
  id: string;
  slug: string;
  title: string;
  kind: string;
  transport: string;
  url: string;
  command: string;
  args: string[] | string;
  env: Record<string, string> | string;
  headers: Record<string, string> | string;
  oauth: boolean;
  enabled: boolean;
}

interface McpGatewayKey {
  id: string;
  name: string | null;
  machineId?: string;
  createdAt?: string;
}

interface TestResult {
  loading?: boolean;
  ok?: boolean;
  error?: string;
  toolCount?: number;
  sample?: Array<{ name: string }>;
}

interface ConfirmTarget {
  kind: "instance" | "key";
  id: string;
}

// Shape of the form used in InstanceEditModal (serialised args/env/headers as strings)
interface InstanceForm {
  id?: string;
  slug: string;
  title: string;
  kind: string;
  transport: string;
  url: string;
  command: string;
  args: string;
  env: string;
  headers: string;
  oauth: boolean;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyInstance() {
  return {
    slug: "",
    title: "",
    kind: "http",
    transport: "http",
    url: "",
    command: "",
    args: "[]",
    env: "{}",
    headers: "{}",
    oauth: false,
    enabled: true,
  };
}

function parseMaybeJson(s: string, fallback: JsonValue) {
  if (!s || typeof s !== "string") return fallback;
  try { return JSON.parse(s) as JsonValue; } catch { return fallback; }
}

function stringifyMaybe(v: JsonValue | string | null | undefined) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function McpGatewayPage() {
  const [instances, setInstances] = useState<McpInstance[]>([]);
  const [keys, setKeys] = useState<McpGatewayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InstanceForm | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<{ key: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmTarget | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const notify = useNotificationStore((s: { addNotification: (n: { type: string; message: string }) => void }) => s.addNotification);
  const { copied, copy } = useCopyToClipboard(2000);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [instRes, keyRes] = await Promise.all([
        fetch("/api/mcp-gateway/instances"),
        fetch("/api/mcp-gateway/keys"),
      ]);
      const instBody = instRes.ok ? await instRes.json().catch(() => ({})) as { instances?: McpInstance[]; error?: string } : {} as { instances?: McpInstance[]; error?: string };
      const keyBody = keyRes.ok ? await keyRes.json().catch(() => ({})) as { keys?: McpGatewayKey[]; error?: string } : {} as { keys?: McpGatewayKey[]; error?: string };
      if (!instRes.ok) {
        notify({ type: "error", message: instBody.error ?? `Failed to load instances (${instRes.status})` });
      }
      if (!keyRes.ok) {
        notify({ type: "error", message: keyBody.error ?? `Failed to load keys (${keyRes.status})` });
      }
      setInstances(instBody.instances ?? []);
      setKeys(keyBody.keys ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load MCP Gateway data";
      notify({ type: "error", message: msg });
      setInstances([]);
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void reload(); }, [reload]);

  // ----- Instance CRUD -----
  async function saveInstance(form: InstanceForm) {
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
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) {
      notify({ type: "error", message: body.error ?? `save failed (${res.status})` });
      return false;
    }
    notify({ type: "success", message: isNew ? "Instance created" : "Instance updated" });
    setEditing(null);
    await reload();
    return true;
  }

  async function deleteInstance(id: string) {
    const res = await fetch(`/api/mcp-gateway/instances/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      notify({ type: "error", message: body.error ?? "delete failed" });
      return;
    }
    notify({ type: "success", message: "Instance deleted" });
    setConfirmDelete(null);
    await reload();
  }

  async function connectInstance(id: string) {
    try {
      const authRes = await fetch(`/api/mcp-gateway/oauth/${id}/authorize`);
      const authBody = await authRes.json().catch(() => ({})) as { url?: string; state?: string; error?: string };
      if (!authRes.ok || !authBody.url) {
        notify({ type: "error", message: authBody.error ?? `authorize failed (${authRes.status})` });
        return;
      }
      const popup = window.open(authBody.url, "_blank", "noopener,noreferrer");
      if (!popup) {
        notify({ type: "error", message: "popup blocked — allow popups for this site" });
        return;
      }
      const state = authBody.state;
      const startedAt = Date.now();
      const pollMs = 1500;
      const maxMs = 60_000;
      const tick = async () => {
        if (Date.now() - startedAt > maxMs) {
          notify({ type: "warning", message: "OAuth flow timed out — check the popup tab" });
          return;
        }
        try {
          const r = await fetch(`/api/mcp-gateway/oauth/${id}/status?state=${encodeURIComponent(state ?? "")}`);
          const b = await r.json() as { status?: string; error?: string };
          if (b.status === "complete") {
            notify({ type: "success", message: "Connected" });
            await reload();
            return;
          }
          if (b.status === "error") {
            notify({ type: "error", message: b.error ?? "OAuth failed" });
            await reload();
            return;
          }
        } catch { /* keep polling */ }
        setTimeout(() => { void tick(); }, pollMs);
      };
      setTimeout(() => { void tick(); }, pollMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OAuth error";
      notify({ type: "error", message: msg });
    }
  }

  async function testInstance(id: string) {
    setTestResults((m) => ({ ...m, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/mcp-gateway/instances/${id}/test`, { method: "POST" });
      const body = await res.json() as TestResult;
      setTestResults((m) => ({ ...m, [id]: body }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "test failed";
      setTestResults((m) => ({ ...m, [id]: { ok: false, error: msg } }));
    }
  }

  // ----- Key CRUD -----
  async function createKey() {
    const name = window.prompt("Gateway key name (optional):") ?? null;
    const res = await fetch("/api/mcp-gateway/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await res.json() as { key?: { key: string }; error?: string };
    if (!res.ok) {
      notify({ type: "error", message: body.error ?? "create failed" });
      return;
    }
    setCreatedKey(body.key ?? null);
    await reload();
  }

  async function deleteKey(id: string) {
    const res = await fetch(`/api/mcp-gateway/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      notify({ type: "error", message: body.error ?? "delete failed" });
      return;
    }
    notify({ type: "success", message: "Key deleted" });
    setConfirmDelete(null);
    setEditingKey(null);
    await reload();
  }

  async function saveGrants(keyId: string, instanceIds: string[]) {
    const res = await fetch(`/api/mcp-gateway/keys/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: instanceIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      notify({ type: "error", message: body.error ?? "save failed" });
      return;
    }
    notify({ type: "success", message: "Grants updated" });
    await reload();
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">MCP Gateway</h1>
          <p className="text-sm text-text-muted mt-1">
            Register upstream MCP servers and expose them through one endpoint.
            Tools appear as <code className="px-1 rounded bg-surface-2">&lt;slug&gt;__&lt;toolName&gt;</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon="vpn_key" onClick={() => { void createKey(); }}>New key</Button>
          <Button icon="add" onClick={() => setEditing(emptyInstance())}>New instance</Button>
        </div>
      </div>

      {/* Instances */}
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
                      {i.transport === "stdio"
                        ? `${i.command} ${(Array.isArray(i.args) ? i.args : []).join(" ")}`
                        : i.url}
                    </div>
                    {test && !test.loading && (
                      <div className="mt-2 text-xs">
                        {test.ok ? (
                          <span className="text-green-600 dark:text-green-400">
                            {test.toolCount} tools
                            {test.sample?.length
                              ? ` — sample: ${test.sample.map((s) => s.name).join(", ")}`
                              : ""}
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">test failed: {test.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" icon="play_arrow" onClick={() => { void testInstance(i.id); }} loading={test?.loading}>Test</Button>
                    {i.oauth && <Button size="sm" variant="ghost" icon="login" onClick={() => { void connectInstance(i.id); }}>Connect</Button>}
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing({
                      ...i,
                      args: stringifyMaybe(typeof i.args !== "string" ? JSON.stringify(i.args) : i.args),
                      env: stringifyMaybe(typeof i.env !== "string" ? JSON.stringify(i.env) : i.env),
                      headers: stringifyMaybe(typeof i.headers !== "string" ? JSON.stringify(i.headers) : i.headers),
                    })}>Edit</Button>
                    <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete({ kind: "instance", id: i.id })} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Keys */}
      <Card title="Gateway Keys" subtitle="API keys that harnesses use to talk to the gateway">
        {keys.length === 0 ? (
          <p className="text-sm text-text-muted">No gateway keys yet. Click &quot;New key&quot; to mint one.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-start gap-3 p-3 rounded-[10px] border border-border-subtle bg-surface-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text-main">{k.name ?? <span className="text-text-muted">unnamed</span>}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {k.machineId ? `machine ${k.machineId.slice(0, 8)}…` : ""} · created {k.createdAt?.slice(0, 10)}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" icon="tune" onClick={() => setEditingKey(k.id)}>Grants</Button>
                  <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete({ kind: "key", id: k.id })} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Instance edit modal */}
      {editing && (
        <InstanceEditModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={saveInstance}
        />
      )}

      {/* Grants modal */}
      {editingKey && (
        <GrantsModal
          keyId={editingKey}
          allInstances={instances}
          onClose={() => setEditingKey(null)}
          onSave={saveGrants}
        />
      )}

      {/* Newly created key reveal modal */}
      {createdKey && (
        <Modal isOpen onClose={() => setCreatedKey(null)} title="Gateway key created" showTrafficLights>
          <p className="text-sm text-text-muted mb-2">
            Copy this key now — you will not see it again.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 rounded-[8px] bg-surface-2 font-mono text-xs break-all">
              {createdKey.key}
            </code>
            <Button onClick={() => copy(createdKey.key)} icon={copied ? "check" : "content_copy"}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Modal>
      )}

      {/* Confirm delete */}
      {confirmDelete?.kind === "instance" && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => { void deleteInstance(confirmDelete.id); }}
          title="Delete instance?"
          message="All grants to this instance will also be removed."
        />
      )}
      {confirmDelete?.kind === "key" && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => { void deleteKey(confirmDelete.id); }}
          title="Delete gateway key?"
          message="Any harness using this key will lose access immediately."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface InstanceEditModalProps {
  initial: InstanceForm;
  onClose: () => void;
  onSave: (form: InstanceForm) => Promise<boolean>;
}

function InstanceEditModal({ initial, onClose, onSave }: InstanceEditModalProps) {
  const [form, setForm] = useState<InstanceForm>({
    ...emptyInstance(),
    ...initial,
  });
  const isStdio = form.transport === "stdio" || ["npx", "python", "docker", "command"].includes(form.kind);
  const isHttpLike = form.transport === "http" || form.transport === "sse";

  function patch(p: Partial<InstanceForm>) { setForm((f) => ({ ...f, ...p })); }

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
          <Button onClick={() => { void onSave(form); }} icon="save">Save</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Slug" required value={form.slug} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ slug: e.target.value.toLowerCase() })} placeholder="jira-acme" hint="lowercase, digits, dashes; 2-40 chars; no __" />
          <Input label="Title" value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ title: e.target.value })} placeholder="Jira (Acme)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Kind" required value={form.kind} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => patch({ kind: e.target.value })} options={KIND_OPTIONS} />
          <Select label="Transport" value={form.transport} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => patch({ transport: e.target.value })} options={TRANSPORT_OPTIONS} />
        </div>

        {isHttpLike ? (
          <Input label="URL" required value={form.url} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
        ) : (
          <>
            <Input label="Command" required value={form.command} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ command: e.target.value })} placeholder="npx" />
            <Input label="Args (JSON array)" value={form.args} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ args: e.target.value })} hint='e.g. ["-y", "@browsermcp/mcp@latest"]' />
            <Input label="Env (JSON object)" value={form.env} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ env: e.target.value })} hint='e.g. {"API_KEY":"..."}' />
          </>
        )}

        {isHttpLike && (
          <Input label="Headers (JSON object)" value={form.headers} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ headers: e.target.value })} hint='merged into every request; cannot override Content-Type/Accept/mcp-*' />
        )}

        <div className="flex items-center gap-6 pt-1">
          <Toggle checked={form.oauth} onChange={(v: boolean) => patch({ oauth: v })} label="Requires OAuth" description="Instance needs an Authorization token from a browser login" />
          <Toggle checked={form.enabled} onChange={(v: boolean) => patch({ enabled: v })} label="Enabled" />
        </div>
      </div>
    </Modal>
  );
}

interface GrantsModalProps {
  keyId: string;
  allInstances: McpInstance[];
  onClose: () => void;
  onSave: (keyId: string, instanceIds: string[]) => Promise<void>;
}

function GrantsModal({ keyId, allInstances, onClose, onSave }: GrantsModalProps) {
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/mcp-gateway/keys/${keyId}`);
        const body = await r.json() as { grants?: string[] };
        setGrants(new Set(body.grants ?? []));
      } finally {
        setLoading(false);
      }
    })();
  }, [keyId]);

  function toggle(id: string) {
    setGrants((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Manage instance grants"
      size="md"
      showTrafficLights
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { void onSave(keyId, [...grants]); onClose(); }} icon="save" disabled={loading}>Save</Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : allInstances.length === 0 ? (
        <p className="text-sm text-text-muted">No instances exist yet. Create one first.</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {allInstances.map((i) => (
            <label
              key={i.id}
              className="flex items-center gap-3 p-2 rounded-[8px] hover:bg-surface-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={grants.has(i.id)}
                onChange={() => toggle(i.id)}
                className="size-4 rounded border-border"
              />
              <span className="font-mono text-sm">{i.slug}</span>
              <Badge size="sm" variant="default">{i.kind}</Badge>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

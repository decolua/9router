"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
  ConfirmModal,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { isRecord } from "@/lib/mcp/gateway/guards";

function isGatewayKey(value) {
  return isRecord(value) && typeof value.id === "string" && (typeof value.name === "string" || value.name === null);
}

function parseGatewayKeys(value) {
  return Array.isArray(value) ? value.filter(isGatewayKey) : [];
}

function parseGrantInstances(value) {
  return Array.isArray(value)
    ? value.filter((i) => isRecord(i) && typeof i.id === "string" && typeof i.slug === "string" && typeof i.kind === "string")
    : [];
}

function parseStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function maskKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}

export default function McpGatewayKeysPage() {
  const [keys, setKeys] = useState([]);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [showKeyForRow, setShowKeyForRow] = useState(new Set());
  const notify = useNotificationStore((s) => s.addNotification);
  const { copied, copy } = useCopyToClipboard(2000);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [keyRes, instRes] = await Promise.all([
        fetch("/api/mcp-gateway/keys"),
        fetch("/api/mcp-gateway/instances"),
      ]);
      const keyBody = keyRes.ok ? await keyRes.json().catch(() => ({})) : {};
      const instBody = instRes.ok ? await instRes.json().catch(() => ({})) : {};
      if (!keyRes.ok) notify({ type: "error", message: keyBody.error || `Failed to load keys (${keyRes.status})` });
      setKeys(parseGatewayKeys(keyBody.keys));
      setInstances(parseGrantInstances(instBody.instances));
    } catch (e) {
      notify({ type: "error", message: (e instanceof Error ? e.message : "Failed to load gateway keys") });
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    Promise.resolve().then(() => reload());
  }, [reload]);

  async function handleCreateKey() {
    if (!newKeyName.trim()) return;
    try {
      const res = await fetch("/api/mcp-gateway/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        notify({ type: "error", message: body.error || "create failed" });
        return;
      }
      setCreatedKey(isGatewayKey(body.key) ? body.key : null);
      await reload();
      setNewKeyName("");
      setShowAddModal(false);
    } catch (e) {
      notify({ type: "error", message: (e instanceof Error ? e.message : "create failed") });
    }
  }

  async function deleteKey(id) {
    const res = await fetch(`/api/mcp-gateway/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      notify({ type: "error", message: body.error || "delete failed" });
      return;
    }
    notify({ type: "success", message: "Key deleted" });
    setConfirmDelete(null);
    setRevealedKeys((m) => { const n = { ...m }; delete n[id]; return n; });
    setShowKeyForRow((s) => { const n = new Set(s); n.delete(id); return n; });
    await reload();
  }

  async function saveGrants(keyId, instanceIds) {
    const res = await fetch(`/api/mcp-gateway/keys/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: instanceIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      notify({ type: "error", message: body.error || "save failed" });
      return;
    }
    notify({ type: "success", message: "Grants updated" });
    await reload();
  }

  async function revealKey(k) {
    if (revealedKeys[k.id]) {
      setShowKeyForRow((s) => { const n = new Set(s); n.add(k.id); return n; });
      return revealedKeys[k.id];
    }
    try {
      const r = await fetch(`/api/mcp-gateway/keys/${k.id}?reveal=1`);
      const body = await r.json();
      if (!r.ok) {
        notify({ type: "error", message: body.error || "reveal failed" });
        return "";
      }
      const raw = isRecord(body.key) && typeof body.key.key === "string" ? body.key.key : "";
      setRevealedKeys((m) => ({ ...m, [k.id]: raw }));
      setShowKeyForRow((s) => { const n = new Set(s); n.add(k.id); return n; });
      return raw;
    } catch (e) {
      notify({ type: "error", message: (e instanceof Error ? e.message : "reveal failed") });
      return "";
    }
  }

  function hideKey(id) {
    setShowKeyForRow((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">MCP Keys</h1>
          <p className="text-sm text-text-muted mt-1">
            API keys that harnesses use to talk to the MCP gateway.
          </p>
        </div>
        <Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>
      </div>

      <Card title="Gateway Keys" subtitle="API keys that harnesses use to talk to the gateway">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No gateway keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first gateway key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((k) => {
              const isShown = showKeyForRow.has(k.id);
              const raw = revealedKeys[k.id] ?? "";
              return (
                <div
                  key={k.id}
                  className="group flex items-start justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-text-main">{k.name || <span className="text-text-muted">unnamed</span>}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isShown ? (
                        <code className="text-xs text-text-muted font-mono break-all">{raw}</code>
                      ) : (
                        <code className="text-xs text-text-muted font-mono">
                          {raw ? maskKey(raw) : "••••••••••"}
                        </code>
                      )}
                      <button
                        onClick={() => isShown ? hideKey(k.id) : revealKey(k)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        title={isShown ? "Hide key" : "Show key"}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isShown ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                      <button
                        onClick={async () => {
                          const cached = revealedKeys[k.id];
                          const val = cached || (await revealKey(k));
                          if (val) copy(val, k.id);
                        }}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        title="Copy key"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === k.id ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {k.machineId ? `machine ${k.machineId.slice(0, 8)}… · ` : ""}created {k.createdAt?.slice(0, 10)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" icon="tune" onClick={() => setEditingKey(k.id)}>Grants</Button>
                    <button
                      onClick={() => setConfirmDelete(k.id)}
                      className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create Gateway Key"
        onClose={() => { setShowAddModal(false); setNewKeyName(""); }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="My harness"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>Create</Button>
            <Button onClick={() => { setShowAddModal(false); setNewKeyName(""); }} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Created Key reveal modal */}
      {createdKey && (
        <Modal
          isOpen
          onClose={() => setCreatedKey(null)}
          title="Gateway Key Created"
        >
          <div className="flex flex-col gap-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
                Save this key now!
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This is the only time you will see this key. Store it securely.
              </p>
            </div>
            <div className="flex gap-2">
              <Input value={createdKey.key ?? ""} readOnly className="flex-1 font-mono text-sm" />
              <Button
                variant="secondary"
                icon={copied === "created_key" ? "check" : "content_copy"}
                onClick={() => createdKey.key && copy(createdKey.key, "created_key")}
              >
                {copied === "created_key" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <Button onClick={() => setCreatedKey(null)} fullWidth>Done</Button>
          </div>
        </Modal>
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

      {/* Confirm delete */}
      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteKey(confirmDelete)}
        title="Delete gateway key?"
        message="Any harness using this key will lose access immediately."
      />
    </div>
  );
}

function GrantsModal({ keyId, allInstances, onClose, onSave }) {
  const [grants, setGrants] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/mcp-gateway/keys/${keyId}`);
        const body = await r.json();
        setGrants(new Set(parseStringArray(body.grants)));
      } catch {
        setGrants(new Set());
      } finally {
        setLoading(false);
      }
    })();
  }, [keyId]);

  function toggle(id) {
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
          <Button onClick={() => { onSave(keyId, [...grants]); onClose(); }} icon="save" disabled={loading}>Save</Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : allInstances.length === 0 ? (
        <p className="text-sm text-text-muted">No instances exist yet. Create one first under MCP → Servers.</p>
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

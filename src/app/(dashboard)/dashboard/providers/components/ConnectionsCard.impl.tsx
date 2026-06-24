"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import React from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import {
  Card as _Card,
  Badge as _Badge,
  Button as _Button,
  Modal as _Modal,
  Select as _Select,
  Toggle as _Toggle,
  EditConnectionModal as _EditConnectionModal,
  ConfirmModal as _ConfirmModal,
} from "@/shared/components";
import type { JsonValue } from "open-sse/types/executor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const asJson = (res: Response) => res.json() as Promise<JsonValue>;
const strOf = (v: JsonValue | undefined) => typeof v === "string" ? v : "";
const boolOf = (v: JsonValue | undefined) => v === true;
const recOf = (v: JsonValue | undefined): Record<string, JsonValue> =>
  (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, JsonValue>) : {};
const arrOf = (v: JsonValue | undefined) => Array.isArray(v) ? v as JsonValue[] : [] as JsonValue[];

// ---------------------------------------------------------------------------
// Typed shims for JS shared components
// ---------------------------------------------------------------------------
interface BadgeProps { variant?: string; size?: string; dot?: boolean; children?: ReactNode; }
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: string; size?: string; icon?: string; fullWidth?: boolean; loading?: boolean; children?: ReactNode; }
interface CardProps { children?: ReactNode; title?: string; subtitle?: string; icon?: string; action?: ReactNode; padding?: string; hover?: boolean; elev?: boolean; className?: string; }
interface ModalProps { isOpen?: boolean; onClose?: () => void; title?: string; children?: ReactNode; footer?: ReactNode; }
interface SelectOption { value: string; label: string; }
interface SelectProps { label?: string; value?: string; onChange?: (e: { target: { value: string } }) => void; options?: SelectOption[]; }
interface ToggleProps { checked?: boolean; onChange?: (v?: boolean) => void; disabled?: boolean; size?: string; title?: string; }
interface EditConnectionModalProps { isOpen?: boolean; connection?: Connection | null; proxyPools?: ProxyPool[]; onSave?: (data: Partial<Connection>) => void; onClose?: () => void; }
interface ConfirmModalProps { isOpen?: boolean; onClose?: () => void; onConfirm?: () => void | Promise<void>; title?: string; message?: string; variant?: string; }

const Card            = _Card            as ComponentType<CardProps>;
const Badge           = _Badge           as ComponentType<BadgeProps>;
const Button          = _Button          as ComponentType<ButtonProps>;
const Modal           = _Modal           as ComponentType<ModalProps>;
const Select          = _Select          as ComponentType<SelectProps>;
const Toggle          = _Toggle          as ComponentType<ToggleProps>;
const EditConnectionModal = _EditConnectionModal as ComponentType<EditConnectionModalProps>;
const ConfirmModal    = _ConfirmModal    as ComponentType<ConfirmModalProps>;

// ---------------------------------------------------------------------------
// Domain interfaces
// ---------------------------------------------------------------------------
interface ProxyPool {
  id: string;
  name: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
}

interface Connection {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  provider?: string;
  apiKey?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number;
  providerSpecificData?: Record<string, JsonValue>;
  [key: string]: JsonValue | undefined;
}

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// CooldownTimer
// ---------------------------------------------------------------------------
interface CooldownTimerProps { until: string; }

function CooldownTimer({ until }: CooldownTimerProps) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) { setRemaining(""); return; }
      const s = Math.floor(diff / 1000);
      if (s < 60) setRemaining(`${s}s`);
      else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!remaining) return null;
  return <span className="text-xs text-orange-500 font-mono">⏱ {remaining}</span>;
}

// ---------------------------------------------------------------------------
// ConnectionRow
// ---------------------------------------------------------------------------
interface ConnectionRowProps {
  connection: Connection;
  proxyPools?: ProxyPool[];
  isOAuth: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: (isActive: boolean) => void;
  onUpdateProxy?: (poolId: string | null) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onReauth?: () => void;
}

function ConnectionRow({
  connection, proxyPools, isOAuth, isFirst, isLast,
  onMoveUp, onMoveDown, onToggleActive, onUpdateProxy,
  onEdit, onDelete, onReauth,
}: ConnectionRowProps) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const proxyDropdownRef = useRef<HTMLDivElement>(null);

  const safeProxyPools = proxyPools ?? [];
  const proxyPoolMap = new Map(safeProxyPools.map((p) => [p.id, p]));
  const psd = connection.providerSpecificData ?? {};
  const boundProxyPoolId = strOf(psd["proxyPoolId"]) || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = boolOf(psd["connectionProxyEnabled"]) && !!strOf(psd["connectionProxyUrl"]);
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId ? `Pool: ${boundProxyPoolId} (inactive/missing)`
    : hasLegacyProxy ? `Legacy: ${strOf(psd["connectionProxyUrl"])}` : "";

  let maskedProxyUrl = "";
  const rawProxyUrl = boundProxyPool?.proxyUrl ?? strOf(psd["connectionProxyUrl"]);
  if (rawProxyUrl) {
    try {
      const p = new URL(rawProxyUrl);
      maskedProxyUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
    } catch { maskedProxyUrl = rawProxyUrl; }
  }

  const noProxyText = boundProxyPool?.noProxy ?? strOf(psd["connectionNoProxy"]);
  const proxyBadgeVariant = boundProxyPool?.isActive === true ? "success" : (boundProxyPoolId || hasLegacyProxy) ? "error" : "default";

  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => typeof v === "string" ? v : "")
    .filter(Boolean)
    .sort()[0] ?? null;

  useEffect(() => {
    const check = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => typeof v === "string" ? v : "")
        .filter((v) => v && new Date(v).getTime() > Date.now())
        .sort()[0] ?? null;
      setIsCooldown(!!until);
    };
    check();
    const t = modelLockUntil ? setInterval(check, 1000) : null;
    return () => { if (t) clearInterval(t); };
  }, [modelLockUntil, connection]);

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus = connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const displayName = isOAuth
    ? connection.name ?? connection.email ?? connection.displayName ?? "OAuth Account"
    : connection.name;

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try { await onUpdateProxy?.(poolId === "__none__" ? null : poolId); }
    finally { setUpdatingProxy(false); setShowProxyDropdown(false); }
  };

  return (
    <div className={`group flex flex-col gap-3 p-2 rounded-lg sm:flex-row sm:items-center sm:justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex w-full min-w-0 flex-1 items-start gap-3 sm:items-center">
        <div className="flex flex-col">
          <button onClick={onMoveUp} disabled={isFirst} className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}>
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button onClick={onMoveDown} disabled={isLast} className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}>
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-text-muted">{isOAuth ? "lock" : "key"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus ?? "Unknown")}
            </Badge>
            {hasAnyProxy && <Badge variant={proxyBadgeVariant} size="sm">Proxy</Badge>}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil!} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>{connection.lastError}</span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-text-muted truncate max-w-[420px]" title={proxyDisplayText}>{proxyDisplayText}</span>
              {maskedProxyUrl && <code className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-text-muted">{maskedProxyUrl}</code>}
              {noProxyText && <span className="text-[11px] text-text-muted truncate max-w-[320px]" title={noProxyText}>no_proxy: {noProxyText}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-wrap gap-1">
          {safeProxyPools.length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">{updatingProxy ? "progress_activity" : "lan"}</span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                  <button onClick={() => handleSelectProxy("__none__")} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}>None</button>
                  {safeProxyPools.map((pool) => (
                    <button key={pool.id} onClick={() => handleSelectProxy(pool.id)} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}>{pool.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isOAuth && onReauth && (
            <button
              onClick={() => onReauth()}
              className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
              title="Re-authenticate (refresh OAuth token in place)"
            >
              <span className="material-symbols-outlined text-[18px]">cached</span>
              <span className="text-[10px] leading-tight">Re-auth</span>
            </button>
          )}
          <button onClick={onEdit} className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="flex flex-col items-center px-2 py-1 rounded hover:bg-red-500/10 text-red-500">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle size="sm" checked={connection.isActive ?? true} onChange={(v) => onToggleActive(v ?? true)} title={(connection.isActive ?? true) ? "Disable" : "Enable"} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddApiKeyModal
// ---------------------------------------------------------------------------
interface AddApiKeyModalProps {
  isOpen: boolean;
  provider?: string;
  providerName?: string;
  proxyPools?: ProxyPool[];
  onSave: (data: Partial<Connection>) => Promise<void>;
  onClose: () => void;
}

function AddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }: AddApiKeyModalProps) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: NONE });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await asJson(res);
      setValidationResult(boolOf(recOf(data)["valid"]) ? "success" : "failed");
    } catch { setValidationResult("failed"); }
    finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await asJson(res);
        isValid = boolOf(recOf(data)["valid"]);
        setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); }
      finally { setValidating(false); }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        providerSpecificData: { proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId } as Record<string, JsonValue>,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName ?? provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Name</label>
          <input className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Key" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">API Key</label>
            <input type="password" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} />
          </div>
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div>
          <label className="text-xs text-text-muted mb-1 block">Priority</label>
          <input type="number" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })} />
        </div>
        <Select label="Proxy Pool" value={formData.proxyPoolId} onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[{ value: NONE, label: "None" }, ...(proxyPools ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ConnectionsCard — main export
// ---------------------------------------------------------------------------
interface ConnectionsCardProps {
  providerId: string;
  isOAuth?: boolean;
}

export default function ConnectionsCard({ providerId, isOAuth }: ConnectionsCardProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("1");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const load_ = useCallback(async () => {
    const [connRes, proxyRes, settingsRes] = await Promise.all([
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
    ]);
    const connData = await asJson(connRes);
    const proxyData = await asJson(proxyRes);
    const settingsData = settingsRes.ok ? await asJson(settingsRes) : {};
    return { connRes, proxyRes, connData, proxyData, settingsData: settingsData as JsonValue };
  }, []);

  const apply_ = useCallback(({ connRes, proxyRes, connData, proxyData, settingsData }: {
    connRes: Response; proxyRes: Response;
    connData: JsonValue; proxyData: JsonValue; settingsData: JsonValue;
  }) => {
    if (connRes.ok) {
      const all = arrOf(recOf(connData)["connections"]);
      setConnections(
        all
          .map((c) => recOf(c as JsonValue) as unknown as Connection)
          .filter((c) => c.provider === providerId)
      );
    }
    if (proxyRes.ok) setProxyPools(arrOf(recOf(proxyData)["proxyPools"]).map((p) => recOf(p as JsonValue) as unknown as ProxyPool));
    const strategies = recOf(recOf(settingsData)["providerStrategies"]);
    const override = recOf(strategies[providerId]);
    setProviderStrategy(strOf(override["fallbackStrategy"]) || null);
    const sticky = override["stickyRoundRobinLimit"];
    setProviderStickyLimit(sticky != null ? String(sticky) : "1");
  }, [providerId]);

  const fetch_ = useCallback(() =>
    load_().then(apply_).catch((e) => console.log("ConnectionsCard fetch error:", e)).finally(() => setLoading(false)),
    [load_, apply_]
  );

  useEffect(() => {
    load_().then(apply_).catch((e) => console.log("ConnectionsCard fetch error:", e)).finally(() => setLoading(false));
  }, [load_, apply_]);

  const saveStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await asJson(res) : {} as JsonValue;
      const current = recOf(recOf(data)["providerStrategies"]);
      const override: Record<string, JsonValue> = {};
      if (strategy) override["fallbackStrategy"] = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") override["stickyRoundRobinLimit"] = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (e) { console.log("saveStrategy error:", e); }
  };

  const handleSwapPriority = async (i1: number, i2: number) => {
    const next = [...connections];
    const a = next[i1]!;
    const b = next[i2]!;
    next[i1] = b;
    next[i2] = a;
    setConnections(next);
    try {
      await Promise.all([
        fetch(`/api/providers/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i1 }) }),
        fetch(`/api/providers/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i2 }) }),
      ]);
    } catch { await fetch_(); }
  };

  const handleDelete = (id: string) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
        } catch (e) { console.log("delete error:", e); }
      }
    });
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
    } catch (e) { console.log("toggle error:", e); }
  };

  const handleUpdateProxy = async (connId: string, proxyPoolId: string | null) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: proxyPoolId ?? null }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === connId ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId ?? null } as Record<string, JsonValue> } : c));
    } catch (e) { console.log("proxy error:", e); }
  };

  const handleSaveApiKey = async (formData: Partial<Connection>) => {
    try {
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, ...formData }) });
      if (res.ok) { await fetch_(); setShowAddModal(false); }
    } catch (e) { console.log("save apikey error:", e); }
  };

  const handleUpdateConnection = async (formData: Partial<Connection>) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection?.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { await fetch_(); setShowEditModal(false); }
    } catch (e) { console.log("update connection error:", e); }
  };

  const handleReauth = async (conn: Connection) => {
    if (!conn?.id) return;
    try {
      const res = await fetch(`/api/providers/${conn.id}/reauth`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as Record<string, string>;
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("toast", { detail: { type: "success", message: "Token refreshed" } }));
        await fetch_();
        return;
      }
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent("toast", { detail: { type: "error", message: "Refresh token expired — redirecting to re-login" } }));
        window.location.assign(`/api/oauth/${providerId}/start`);
        return;
      }
      window.dispatchEvent(new CustomEvent("toast", { detail: { type: "error", message: body?.["error"] ?? "Re-auth failed" } }));
    } catch (e) {
      console.log("reauth error:", e);
      window.dispatchEvent(new CustomEvent("toast", { detail: { type: "error", message: "Re-auth failed" } }));
    }
  };

  if (loading) return <Card><div className="h-20 animate-pulse bg-black/5 rounded-lg" /></Card>;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold">Connections</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle
              checked={providerStrategy === "round-robin"}
              onChange={(enabled) => {
                const strategy = enabled ? "round-robin" : null;
                setProviderStrategy(strategy);
                if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
                saveStrategy(strategy, enabled ? (providerStickyLimit || "1") : providerStickyLimit);
              }}
            />
            {providerStrategy === "round-robin" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">Sticky:</span>
                <input
                  type="number" min={1} value={providerStickyLimit}
                  onChange={(e) => { setProviderStickyLimit(e.target.value); saveStrategy("round-robin", e.target.value); }}
                  className="w-16 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">No connections yet</p>
            <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>Add Connection</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {connections.map((conn, idx) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  proxyPools={proxyPools}
                  isOAuth={isOAuth ?? false}
                  isFirst={idx === 0}
                  isLast={idx === connections.length - 1}
                  onMoveUp={() => handleSwapPriority(idx, idx - 1)}
                  onMoveDown={() => handleSwapPriority(idx, idx + 1)}
                  onToggleActive={(active) => handleToggleActive(conn.id, active)}
                  onUpdateProxy={(poolId) => handleUpdateProxy(conn.id, poolId)}
                  onEdit={() => { setSelectedConnection(conn); setShowEditModal(true); }}
                  onDelete={() => handleDelete(conn.id)}
                  {...(isOAuth ? { onReauth: () => handleReauth(conn) } : {})}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-stretch sm:justify-start">
              <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>Add</Button>
            </div>
          </>
        )}
      </Card>

      <AddApiKeyModal
        isOpen={showAddModal}
        provider={providerId}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        {...(confirmState ? { onConfirm: confirmState.onConfirm, message: confirmState.message } : {})}
        title={confirmState?.title ?? "Confirm"}
        variant="danger"
      />
    </>
  );
}

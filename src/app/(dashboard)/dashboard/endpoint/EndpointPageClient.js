"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal, Select } from "@/shared/components";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, getProviderAlias, FREE_PROVIDERS, AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  TUNNEL_BENEFITS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "./endpointConstants";
import { clientPingUrl, clientPingAny } from "./endpointPing";
import EndpointRow from "./components/EndpointRow";
import StatusAlert from "./components/StatusAlert";
import Tooltip from "./components/Tooltip";
import SecurityWarning from "./components/SecurityWarning";

// ── ModelChipPicker ─────────────────────────────────────────────
// Chip-based model/combo multi-pick shared by the API-key form and the model
// preset form (pattern mirrors the "add model" modal used on the combos page).
// Rules:
//  • Empty search → only the currently-checked entries are shown (the working
//    set); search is how additional models get added.
//  • Non-empty search → every match is shown, grouped by provider, checked ones
//    floated to the top of their group.
//  • Click to toggle. The stored key is the model's routable value (routedModel
//    / node-prefixed id for custom nodes) — unchanged from the checkbox UI.
function ModelChipPicker({ models, combos, nodePrefixById, checkedKeys, search, onToggle, isCustomModelEntry, modelKeyOf, displayKeyOf, activeProviderIds = null }) {
  const checked = (key) => checkedKeys.includes(key);
  const isCustom = (m) => isCustomModelEntry(m);
  const labelFor = (m) => displayKeyOf(m) || modelKeyOf(m);

  // Free providers that need no auth key are always selectable (matches the
  // combos model-selector behavior). When activeProviderIds is null the gate is
  // off (nothing to compare against yet). Custom-node rows are keyed by node id
  // in activeProviderIds but carry provider = display prefix.
  const alwaysShowProviders = new Set(
    Object.values(FREE_PROVIDERS).filter((p) => p.noAuth).map((p) => p.id)
  );
  const providerAllowed = (provider, m) => {
    // A checked model stays listed even if its provider is no longer active,
    // so editing a key/preset never silently drops existing selections.
    if (checked(modelKeyOf(m))) return true;
    if (!activeProviderIds) return true;
    // /api/models rows carry the registry provider id; connections may use the
    // same id or its short alias — normalize both sides before comparing.
    const modelProvider = m?.providerNodeId || resolveProviderId(provider);
    if (activeProviderIds.has(modelProvider)) return true;
    return alwaysShowProviders.has(modelProvider);
  };

  const modelMatches = (m) => {
    const q = (search || "").toLowerCase();
    if (!q) return checked(modelKeyOf(m));
    const key = modelKeyOf(m) || "";
    const name = m.name || "";
    return key.toLowerCase().includes(q) || String(name).toLowerCase().includes(q);
  };
  const comboMatches = (c) => {
    const q = (search || "").toLowerCase();
    if (!q) return checked(c.name);
    return String(c.name || "").toLowerCase().includes(q);
  };

  const visibleCombos = combos.filter(comboMatches);
  const visibleModels = models.filter(modelMatches);

  // Group visible models by provider (display name from node prefix map when custom).
  const groups = {};
  const providerOrder = [];
  for (const m of visibleModels) {
    const provider = m.provider || "other";
    // Built-in provider models only show when that provider is connected
    // (or is a free no-auth provider); custom-node rows always show.
    if (!providerAllowed(provider, m)) continue;
    if (!groups[provider]) {
      providerOrder.push(provider);
      groups[provider] = { models: [] };
    }
    groups[provider].models.push(m);
  }
  for (const provider of providerOrder) {
    const added = groups[provider].models.filter((m) => checked(modelKeyOf(m)));
    const rest = groups[provider].models.filter((m) => !checked(modelKeyOf(m)));
    added.sort((a, b) => (labelFor(a) || "").localeCompare(labelFor(b) || ""));
    rest.sort((a, b) => (labelFor(a) || "").localeCompare(labelFor(b) || ""));
    groups[provider].models = search ? [...added, ...rest] : added;
    if (groups[provider].models.length === 0) {
      delete groups[provider];
      providerOrder.splice(providerOrder.indexOf(provider), 1);
    }
  }

  const providerName = (provider, m) => {
    // Custom compatible nodes carry their node's display name + prefix on the
    // row (added by /api/models); fall back to the registry display name, then
    // the prefix map, then the raw alias.
    const nodeName = m?.providerName;
    if (nodeName) return nodeName;
    const reg = AI_PROVIDERS[resolveProviderId(provider)]?.name;
    if (reg) return reg;
    const prefix = nodePrefixById[provider];
    if (prefix) return prefix;
    return getProviderAlias(provider) || provider;
  };

  const chip = (value, label, opts = {}) => {
    const isOn = checked(value);
    return (
      <button
        key={value}
        type="button"
        onClick={() => onToggle(value)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer ${isOn
          ? "bg-primary text-white border-primary"
          : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"}`}
      >
        {isOn && <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>}
        {label}
        {opts.isCustom && <span className="text-[9px] opacity-70 font-normal uppercase">custom</span>}
        {opts.isCombo && <span className="text-[9px] opacity-70 font-normal uppercase">combo</span>}
      </button>
    );
  };

  const hasAny = visibleCombos.length > 0 || providerOrder.length > 0;

  return (
    <div className="max-h-[40vh] overflow-y-auto custom-scrollbar border border-border rounded-lg p-2 bg-surface-2/50">
      {visibleCombos.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface-2/95 py-0.5 z-10">
            <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
            <span className="text-xs font-medium text-primary">Combos</span>
            <span className="text-[10px] text-text-muted">({visibleCombos.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleCombos.map((combo) => chip(combo.name, combo.name, { isCombo: true }))}
          </div>
        </div>
      )}

      {providerOrder.map((provider) => {
        const groupModels = groups[provider].models;
        const title = providerName(provider, groupModels[0]);
        return (
          <div key={provider} className="mb-2 last:mb-0">
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface-2/95 py-0.5 z-10">
              <span className="text-xs font-medium text-primary">{title}</span>
              <span className="text-[10px] text-text-muted">({groupModels.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groupModels.map((m) => chip(modelKeyOf(m), labelFor(m), { isCustom: isCustom(m) }))}
            </div>
          </div>
        );
      })}

      {!hasAny && (
        <p className="text-xs text-text-muted text-center py-3">
          {search ? "No models match your search." : "No models selected — search to add models."}
        </p>
      )}
    </div>
  );
}

ModelChipPicker.propTypes = {
  models: PropTypes.array,
  combos: PropTypes.array,
  nodePrefixById: PropTypes.object,
  checkedKeys: PropTypes.array,
  search: PropTypes.string,
  onToggle: PropTypes.func.isRequired,
  isCustomModelEntry: PropTypes.func.isRequired,
  modelKeyOf: PropTypes.func.isRequired,
  displayKeyOf: PropTypes.func.isRequired,
  activeProviderIds: PropTypes.instanceOf(Set),
};
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  // Per-key model allow-list + expiry
  const [editingKey, setEditingKey] = useState(null);
  const [keyForm, setKeyForm] = useState({ name: "", allowedModels: null, expiresAt: null });
  const [allModels, setAllModels] = useState([]);
  const [combos, setCombos] = useState([]);
  const [nodePrefixById, setNodePrefixById] = useState({});
  const [activeProviderIds, setActiveProviderIds] = useState(null);
  const [keyPresets, setKeyPresets] = useState([]);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  // Separate preset manager modal (independent from the create/edit key form)
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetDraft, setPresetDraft] = useState([]);
  const [presetSearch, setPresetSearch] = useState("");
  const [editingPresetId, setEditingPresetId] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
 const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

 // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    loadSettings();
    // eslint-disable-next-line react-hooks/immutability -- mount-once; function is a stable reference defined below
    loadModelsAndPresets();
  }, []);

  // Custom models are added/deleted on the provider pages, which dispatch
  // "customModelChanged". Keep the picker's model list in sync so a deleted
  // model disappears and a newly-added one becomes searchable without a reload.
  useEffect(() => {
    const onCustomModelChanged = () => {
      loadModelsAndPresets();
    };
    window.addEventListener("customModelChanged", onCustomModelChanged);
    return () => window.removeEventListener("customModelChanged", onCustomModelChanged);
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false); }
      } else {
        tunnelClientReachableRef.current = false;
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) { tsMissRef.current = 0; setTsReachable(true); if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); } }
        else { tsMissRef.current += 1; if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false); }
      } else {
        tsClientReachableRef.current = false;
      }
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tsEnabled, tsUrl, tunnelReachable, tsReachable]);

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
      const tsUrlVal = data.tailscale?.tunnelUrl || "";
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status", { cache: "no-store" })
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || "");
        setTunnelEnabled(tEnabled);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
        const tsUrlVal = data.tailscale?.tunnelUrl || "";
        setTsUrl(tsUrlVal);
        setTsEnabled(tsEn);
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    try {
      const fetchKeys = async () => {
        const res = await fetch("/api/keys");
        if (!res.ok) return [];
        const data = await res.json();
        return data.keys || [];
      };

      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      if (existing.length === 0) {
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch { /* fall through to empty render */ }
      }
      setKeys(existing.map((k) => ({ ...k, expired: !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now() })));
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  // u2500u2500u2500 Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
  const requestUserAuth = (url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  const loadModelsAndPresets = async () => {
    try {
      const [modelsRes, combosRes, presetsRes, nodesRes, providersRes] = await Promise.all([
        fetch("/api/models", { cache: "no-store" }),
        fetch("/api/combos", { cache: "no-store" }),
        fetch("/api/key-presets", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        // Dedup by the same key used for checkboxes (routedModel/fullModel/provider+model).
        const seen = new Set();
        const unique = [];
        for (const m of data.models || []) {
          if (!m?.model) continue;
          const key = m.routedModel || m.fullModel || `${m.provider}/${m.model}`;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          unique.push(m);
        }
        setAllModels(unique);
      }
      if (combosRes.ok) {
        const data = await combosRes.json();
        setCombos(data.combos || []);
      }
      if (presetsRes.ok) {
        const data = await presetsRes.json();
        setKeyPresets(data.presets || []);
      }
      if (nodesRes.ok) {
        const data = await nodesRes.json();
        // Map compatible-node id -> display prefix so model pickers can label
        // custom models as "prefix/id" (the form clients actually request)
        // instead of the raw generated node id.
        const map = {};
        for (const node of data.nodes || []) {
          if (node?.id && node?.prefix) map[node.id] = node.prefix;
        }
        setNodePrefixById(map);
      }
      if (providersRes.ok) {
        const data = await providersRes.json();
        // Only providers with an active connection are selectable (matches the
        // combos model-selector). Normalize aliases to canonical provider ids so
        // they line up with /api/models rows. null while loading = no gating.
        const active = new Set();
        for (const conn of data.connections || []) {
          if (conn?.provider && conn.isActive !== false) active.add(resolveProviderId(conn.provider));
        }
        setActiveProviderIds(active);
      }
    } catch (error) {
      console.log("Error loading models/presets:", error);
    }
  };

  // Model-picker helpers. /api/models exposes custom compatible-node models with
  // `providerNodeId` set (and provider = the display prefix). Built-in registry
  // providers (openrouter, cx, …) never carry that field, so it cleanly
  // separates user-added custom-node models from stock ones.
  const isCustomModelEntry = (m) => {
    if (m?.providerNodeId) return true;
    if (!m?.provider) return false;
    return isOpenAICompatibleProvider(m.provider)
      || isAnthropicCompatibleProvider(m.provider)
      || isCustomEmbeddingProvider(m.provider);
  };

  const modelKeyOf = (m) => m?.routedModel || m?.fullModel || (m?.provider && m?.model ? `${m.provider}/${m.model}` : null);

  // The routable display form for a model row: custom nodes use "prefix/model",
  // everything else keeps its existing routedModel.
  const displayKeyOf = (m) => {
    const key = modelKeyOf(m);
    if (!key || !m?.provider) return key;
    const prefix = nodePrefixById[m.provider];
    if (!prefix || !key.startsWith(`${m.provider}/`)) return key;
    return `${prefix}${key.slice(m.provider.length)}`;
  };

  // Opens the create-key modal with an optional preset pre-applied.
  const openCreateModal = (presetId) => {
    setEditingKey(null);
    setKeyForm({ name: "", allowedModels: null, expiresAt: null });
    setPresetName("");
    setShowAddModal(true);
    if (presetId) applyPresetById(presetId);
  };

  const openEditModal = (key) => {
    setEditingKey(key);
    setKeyForm({
      name: key.name || "",
      allowedModels: Array.isArray(key.allowedModels) ? [...key.allowedModels] : null,
      expiresAt: key.expiresAt || null,
    });
    setPresetName("");
    setShowAddModal(true);
  };

  const resetKeyModal = () => {
    setShowAddModal(false);
    setEditingKey(null);
    setKeyForm({ name: "", allowedModels: null, expiresAt: null });
    setNewKeyName("");
    setPresetName("");
    setModelSearch("");
  };

  const handleCreateKey = async () => {
    const name = (editingKey ? keyForm.name : newKeyName).trim();
    if (!name) return;

    try {
      if (editingKey) {
        const res = await fetch(`/api/keys/${editingKey.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            allowedModels: keyForm.allowedModels,
            expiresAt: keyForm.expiresAt,
          }),
        });
        if (res.ok) {
          await fetchData();
          resetKeyModal();
        }
        return;
      }

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          allowedModels: keyForm.allowedModels,
          expiresAt: keyForm.expiresAt,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setKeyForm({ name: "", allowedModels: null, expiresAt: null });
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error saving key:", error);
    }
  };

  const openPresetModal = () => {
    setEditingPresetId(null);
    setPresetName("");
    setPresetDraft([]);
    setPresetSearch("");
    setShowPresetMenu(false);
    setShowPresetModal(true);
  };

  const openEditPresetModal = (preset) => {
    setEditingPresetId(preset.id);
    setPresetName(preset.name || "");
    setPresetDraft(Array.isArray(preset.models) ? [...preset.models] : []);
    setPresetSearch("");
    setShowPresetMenu(false);
    setShowPresetModal(true);
  };

  const closePresetModal = () => {
    setShowPresetModal(false);
    setEditingPresetId(null);
    setPresetName("");
    setPresetDraft([]);
    setPresetSearch("");
  };

  const handleSavePreset = async () => {
    const models = presetDraft;
    if (models.length === 0) return;
    const name = presetName.trim();
    if (!name) return;
    setSavingPreset(true);
    try {
      const isEdit = !!editingPresetId;
      const res = await fetch(isEdit ? `/api/key-presets/${editingPresetId}` : "/api/key-presets", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models }),
      });
      if (res.ok) {
        const data = await res.json();
        if (isEdit) {
          setKeyPresets((prev) => prev.map((p) => (p.id === editingPresetId ? data.preset : p)));
        } else {
          setKeyPresets((prev) => [...prev, data.preset]);
        }
        setPresetName("");
        setPresetDraft([]);
        setPresetSearch("");
        setEditingPresetId(null);
      }
    } catch (error) {
      console.log("Error saving preset:", error);
    } finally {
      setSavingPreset(false);
    }
  };

  const togglePresetModel = (modelKey) => {
    setPresetDraft((prev) => {
      const current = [...prev];
      const idx = current.indexOf(modelKey);
      if (idx !== -1) current.splice(idx, 1);
      else current.push(modelKey);
      return current;
    });
  };

  const handleDeletePreset = async (id) => {
    setConfirmState({
      title: "Delete Preset",
      message: "Delete this preset? Existing API keys are not affected.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/key-presets/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeyPresets((prev) => prev.filter((p) => p.id !== id));
          }
        } catch (error) {
          console.log("Error deleting preset:", error);
        }
      },
    });
  };

  const applyPreset = (preset) => {
    if (!preset) {
      setKeyForm((prev) => ({ ...prev, allowedModels: null }));
      return;
    }
    setKeyForm((prev) => ({ ...prev, allowedModels: Array.isArray(preset.models) ? [...preset.models] : [] }));
  };

  const toggleAllowedModel = (modelKey) => {
    setKeyForm((prev) => {
      const current = Array.isArray(prev.allowedModels) ? [...prev.allowedModels] : [];
      const idx = current.indexOf(modelKey);
      if (idx !== -1) current.splice(idx, 1);
      else current.push(modelKey);
      return { ...prev, allowedModels: current.length > 0 ? current : null };
    });
  };

  const applyPresetById = (presetId) => {
    const preset = keyPresets.find((p) => p.id === presetId);
    if (preset) {
      applyPreset(preset);
    } else {
      setKeyForm((prev) => ({ ...prev, allowedModels: null }));
    }
    setShowPresetMenu(false);
  };

  const handleDeleteKey = async (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
            setVisibleKeys(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      }
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const maskKey = (fullKey) => {
    if (!fullKey || fullKey.length <= 10) return fullKey || "";
    return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = baseUrl;

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>

        {/* Endpoint rows */}
        <div className="flex flex-col gap-2">
          {/* Local */}
          <EndpointRow
            label="Local"
            url={currentEndpoint}
            copyId="local_url"
            copied={copied}
            onCopy={copy}
          />
          {/* Cloudflare Tunnel */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
              tunnelEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tunnel</span>
            {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
              <>
                <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}
                </div>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelLoading ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tunnelProgress || "Creating tunnel..."}
                </div>
                <button
                  onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tunnelStatus.message}
                </div>
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              </>
            ) : tunnelChecking ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  Checking...
                </div>
                <button
                  onClick={() => setTunnelChecking(false)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (
              <Button
                size="sm"
                icon="cloud_upload"
                onClick={() => {
                  if (isLoginUnsafe) {
                    setTunnelStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                    return;
                  }
                  if (!requireApiKey) {
                    setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
                    return;
                  }
                  setShowEnableTunnelModal(true);
                }}
              >
                Enable
              </Button>
            )}
          </div>
          {/* Tailscale */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
              tsEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tailscale</span>
            {tsEnabled && !tsLoading && tsReachable ? (
              <>
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsEnabled && !tsLoading && !tsReachable ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tsEverReachable ? "Tailscale reconnecting..." : "Tailscale checking..."}
                </div>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (tsLoading || tsConnecting) ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tsProgress || "Connecting..."}
                </div>
                {tsAuthUrl && (
                  <Button
                    size="sm"
                    icon="open_in_new"
                    onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                  >
                    {tsAuthLabel || "Open"}
                  </Button>
                )}
                <button
                  onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tsStatus.message}
                </div>
                <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Button>
              </>
            ) : (
              <Button
                size="sm"
                icon="vpn_lock"
                onClick={() => {
                  if (isLoginUnsafe) {
                    setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                    return;
                  }
                  handleOpenTsModal();
                }}
                className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
              >
                Enable
              </Button>
            )}
          </div>
        </div>

        {/* Pre-enable security gate banner */}
        {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
          <div className="mt-4">
            <SecurityWarning
              message={unsafeReason}
              action={{ label: "Open settings", href: "/dashboard/profile" }}
            />
          </div>
        )}

        {/* Security warnings when tunnel or tailscale is active */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 flex flex-col gap-2">
            {!requireApiKey && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
            {(!requireLogin || !hasPassword) && (
              <SecurityWarning
                message={
                  !requireLogin
                    ? "Require login is disabled — anyone can access your dashboard via tunnel."
                    : "Dashboard uses the default password — change it in Profile settings."
                }
                action={{
                  label: !requireLogin ? "Enable" : "Change password",
                  href: "/dashboard/profile",
                }}
              />
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
            </div>
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            API Keys
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                icon="bookmark"
                variant="secondary"
                onClick={() => setShowPresetMenu((v) => !v)}
              >
                Model Preset
              </Button>
              {showPresetMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowPresetMenu(false)}
                  />
                  <div className="absolute right-0 mt-1 z-50 w-64 rounded-xl border border-border bg-surface-2 shadow-lg p-1.5 flex flex-col gap-0.5 max-h-72 overflow-y-auto">
                    <p className="text-xs font-medium text-text-muted px-2 py-1">
                      {keyPresets.length === 0 ? "No presets yet" : "Apply a preset to the key form"}
                    </p>
                    {keyPresets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      >
                        <button
                          onClick={() => { setShowPresetMenu(false); openEditPresetModal(p); }}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 flex-1 min-w-0 text-left"
                        >
                          <span className="text-sm font-medium truncate">{p.name}</span>
                          <span className="text-xs text-text-muted shrink-0">
                            {Array.isArray(p.models) ? p.models.length : 0} models
                          </span>
                        </button>
                        <button
                          onClick={() => handleDeletePreset(p.id)}
                          className="p-1.5 mr-1 hover:bg-red-500/10 rounded-md text-red-500 transition-colors shrink-0"
                          title="Delete preset"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={openPresetModal}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left text-primary"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      New Preset…
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button icon="add" onClick={openCreateModal}>
              Create Key
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mb-4 -mt-2">
            <SecurityWarning message="Endpoint is exposed without an API key." />
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={openCreateModal}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`group flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-text-muted font-mono">
                      {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                    </code>
                    <button
                      onClick={() => toggleKeyVisibility(key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                      title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                    <button
                      onClick={() => copy(key.key, key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === key.id ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    <p className="text-xs text-text-muted">
                      Created {new Date(key.createdAt).toLocaleDateString("en-GB")}
                    </p>
                    {key.expiresAt && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          key.expired
                            ? "bg-red-500/10 text-red-500"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {key.expired
                          ? `Expired ${new Date(key.expiresAt).toLocaleDateString("en-GB")}`
                          : `Expires ${new Date(key.expiresAt).toLocaleDateString("en-GB")}`}
                      </span>
                    )}
                    {Array.isArray(key.allowedModels) && key.allowedModels.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                        {key.allowedModels.length} model{key.allowedModels.length > 1 ? "s" : ""} allowed
                      </span>
                    )}
                  </div>
                  {key.isActive === false && (
                    <p className="text-xs text-orange-500 mt-1">Paused</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(key)}
                    className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                    title="Edit key"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
                  <Toggle
                    size="sm"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        setConfirmState({
                          title: "Pause API Key",
                          message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                          onConfirm: async () => {
                            setConfirmState(null);
                            handleToggleKey(key.id, checked);
                          }
                        });
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? "Pause key" : "Resume key"}
                  />
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add / Edit Key Modal */}
      <Modal
        isOpen={showAddModal}
        title={editingKey ? "Edit API Key" : "Create API Key"}
        onClose={resetKeyModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={editingKey ? keyForm.name : newKeyName}
            onChange={(e) => editingKey
              ? setKeyForm((prev) => ({ ...prev, name: e.target.value }))
              : setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />

          {/* Preset selector */}
          {keyPresets.length > 0 && (
            <Select
              label="Preset"
              options={[
                { value: "__none__", label: "No preset (allow all models)" },
                ...keyPresets.map((p) => ({ value: p.id, label: p.name })),
              ]}
              value="__none__"
              onChange={(e) => {
                const preset = keyPresets.find((p) => p.id === e.target.value);
                applyPreset(preset);
              }}
              placeholder="Select a preset…"
            />
          )}

          {/* Allowed models / combos */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-text-main">
                Allowed Models & Combos
              </label>
              {keyForm.allowedModels && keyForm.allowedModels.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setKeyForm((prev) => ({ ...prev, allowedModels: null }))}
                >
                  Allow all models
                </Button>
              )}
            </div>
            <p className="text-xs text-text-muted">
              Leave empty to allow every model and combo. Keys with a restricted list can only
              request the models/combos below.
            </p>

            {allModels.length === 0 && combos.length === 0 ? (
              <p className="text-xs text-text-muted py-1">Loading models…</p>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted">
                    <span className="material-symbols-outlined text-[18px]">search</span>
                  </div>
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models & combos…"
                    className="w-full py-2 pl-10 pr-8 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all duration-150 text-[16px] sm:text-sm"
                  />
                  {modelSearch && (
                    <button
                      onClick={() => setModelSearch("")}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted hover:text-text-main transition-colors"
                      title="Clear search"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  )}
                </div>
                <ModelChipPicker
                  models={allModels}
                  combos={combos}
                  nodePrefixById={nodePrefixById}
                  checkedKeys={Array.isArray(keyForm.allowedModels) ? keyForm.allowedModels : []}
                  search={modelSearch}
                  onToggle={toggleAllowedModel}
                  isCustomModelEntry={isCustomModelEntry}
                  modelKeyOf={modelKeyOf}
                  displayKeyOf={displayKeyOf}
                  activeProviderIds={activeProviderIds}
                />
              </>
            )}
          </div>

          {/* Expiry */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-text-main">Expiration</label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-text-main">
              <input
                type="checkbox"
                checked={!keyForm.expiresAt}
                onChange={(e) => {
                  if (e.target.checked) {
                    setKeyForm((prev) => ({ ...prev, expiresAt: null }));
                  } else {
                    const today = new Date();
                    today.setHours(23, 59, 59, 999);
                    setKeyForm((prev) => ({ ...prev, expiresAt: today.toISOString() }));
                  }
                }}
                className="accent-[var(--brand-500)]"
              />
              Never Expired
            </label>
            {keyForm.expiresAt && (
              <input
                type="date"
                value={keyForm.expiresAt ? keyForm.expiresAt.slice(0, 10) : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setKeyForm((prev) => ({
                    ...prev,
                    expiresAt: val ? new Date(`${val}T23:59:59.999`).toISOString() : null,
                  }));
                }}
                className="w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
              />
            )}
            {keyForm.expiresAt && (
              <p className="text-xs text-text-muted">
                The key will stop working on {new Date(keyForm.expiresAt).toLocaleDateString("en-GB")}.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleCreateKey}
              fullWidth
              disabled={!(editingKey ? keyForm.name : newKeyName).trim()}
            >
              {editingKey ? "Save Changes" : "Create"}
            </Button>
            <Button onClick={resetKeyModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
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
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local 9Router to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Model Preset Manager Modal (separate form) */}
      <Modal
        isOpen={showPresetModal}
        title={editingPresetId ? "Edit Model Preset" : "New Model Preset"}
        onClose={closePresetModal}
      >
        <div className="flex flex-col gap-4">
          <div>
            <Input
              label="Preset Name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g. Coding models"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-text-main">Models & Combos</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[18px]">search</span>
              </div>
              <input
                type="text"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                placeholder="Search models & combos…"
                className="w-full py-2 pl-10 pr-8 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all duration-150 text-[16px] sm:text-sm"
              />
              {presetSearch && (
                <button
                  onClick={() => setPresetSearch("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted hover:text-text-main transition-colors"
                  title="Clear search"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}
            </div>
            <p className="text-xs text-text-muted">
              Select the models and combos to include in this preset.
            </p>
            <ModelChipPicker
              models={allModels}
              combos={combos}
              nodePrefixById={nodePrefixById}
              checkedKeys={presetDraft}
              search={presetSearch}
              onToggle={togglePresetModel}
              isCustomModelEntry={isCustomModelEntry}
              modelKeyOf={modelKeyOf}
              displayKeyOf={displayKeyOf}
              activeProviderIds={activeProviderIds}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSavePreset}
              fullWidth
              disabled={!presetName.trim() || presetDraft.length === 0 || savingPreset}
            >
              {savingPreset ? "Saving…" : editingPresetId ? "Save Changes" : "Save Preset"}
            </Button>
            <Button onClick={closePresetModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};

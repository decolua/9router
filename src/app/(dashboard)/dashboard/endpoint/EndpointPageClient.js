"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal, ModelSelectModal } from "@/shared/components";
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
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyTokenLimit, setNewKeyTokenLimit] = useState("");
  const [newKeyModelMode, setNewKeyModelMode] = useState("all"); // "all" | "custom"
  const [newKeyAllowedModels, setNewKeyAllowedModels] = useState([]);
  const [newKeyCustomPattern, setNewKeyCustomPattern] = useState("");
  const [showModelSelectForCreate, setShowModelSelectForCreate] = useState(false);

  // Edit Key state
  const [editingKey, setEditingKey] = useState(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [editKeyTokenLimit, setEditKeyTokenLimit] = useState("");
  const [editKeyUsedTokens, setEditKeyUsedTokens] = useState(0);
  const [editKeyModelMode, setEditKeyModelMode] = useState("all");
  const [editKeyAllowedModels, setEditKeyAllowedModels] = useState([]);
  const [editKeyCustomPattern, setEditKeyCustomPattern] = useState("");
  const [showModelSelectForEdit, setShowModelSelectForEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [activeProvidersList, setActiveProvidersList] = useState([]);
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

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

      const fetchProviders = async () => {
        try {
          const res = await fetch("/api/providers");
          if (!res.ok) return [];
          const data = await res.json();
          return data.connections || [];
        } catch { return []; }
      };

      let [existing, providers] = await Promise.all([fetchKeys(), fetchProviders()]);
      setActiveProvidersList(providers);

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
      setKeys(existing);
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

  const formatTokens = (n) => {
    const num = Number(n) || 0;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return String(num);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const tokenLimit = newKeyTokenLimit ? Math.max(0, parseInt(newKeyTokenLimit, 10) || 0) : 0;
      const allowedModels = newKeyModelMode === "custom" ? newKeyAllowedModels : null;

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim(),
          tokenLimit,
          allowedModels,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setNewKeyTokenLimit("");
        setNewKeyModelMode("all");
        setNewKeyAllowedModels([]);
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleOpenEditModal = (key) => {
    setEditingKey(key);
    setEditKeyName(key.name || "");
    setEditKeyTokenLimit(key.tokenLimit ? String(key.tokenLimit) : "");
    setEditKeyUsedTokens(key.usedTokens || 0);
    setEditKeyModelMode(Array.isArray(key.allowedModels) && key.allowedModels.length > 0 ? "custom" : "all");
    setEditKeyAllowedModels(Array.isArray(key.allowedModels) ? [...key.allowedModels] : []);
    setEditKeyCustomPattern("");
  };

  const handleUpdateKey = async () => {
    if (!editingKey) return;
    setSavingEdit(true);
    try {
      const tokenLimit = editKeyTokenLimit ? Math.max(0, parseInt(editKeyTokenLimit, 10) || 0) : 0;
      const allowedModels = editKeyModelMode === "custom" ? editKeyAllowedModels : null;

      const res = await fetch(`/api/keys/${editingKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editKeyName.trim() || editingKey.name,
          tokenLimit,
          usedTokens: editKeyUsedTokens,
          allowedModels,
        }),
      });
      if (res.ok) {
        await fetchData();
        setEditingKey(null);
      }
    } catch (error) {
      console.log("Error updating key:", error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetKeyTokens = () => {
    setConfirmState({
      title: "Reset Token Usage",
      message: `Reset used tokens counter for "${editingKey?.name}" to 0?`,
      onConfirm: async () => {
        setConfirmState(null);
        setEditKeyUsedTokens(0);
      }
    });
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
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
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
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`group flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 gap-2 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{key.name}</p>
                    {key.isActive === false && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
                        Paused
                      </span>
                    )}
                    {key.tokenLimit > 0 && (key.usedTokens || 0) >= key.tokenLimit && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                        Quota Exceeded
                      </span>
                    )}
                  </div>
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

                  {/* Token usage and allowed models badges */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-text-muted">
                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-text-muted">toll</span>
                      <span>
                        Tokens: <strong className="text-text-main font-medium">{formatTokens(key.usedTokens || 0)}</strong>
                        {key.tokenLimit > 0 ? (
                          <> / {formatTokens(key.tokenLimit)} ({Math.min(100, Math.round(((key.usedTokens || 0) / key.tokenLimit) * 100))}%)</>
                        ) : (
                          <span className="text-text-muted font-normal"> (Unlimited)</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-text-muted">view_in_ar</span>
                      <span>
                        Models:{" "}
                        {Array.isArray(key.allowedModels) && key.allowedModels.length > 0 ? (
                          <span className="text-primary font-medium" title={key.allowedModels.join(", ")}>
                            {key.allowedModels.length} restricted
                          </span>
                        ) : (
                          <span className="text-text-main">All</span>
                        )}
                      </span>
                    </div>

                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                  </div>

                  {key.tokenLimit > 0 && (
                    <div className="w-full max-w-xs mt-1.5 h-1.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (key.usedTokens || 0) >= key.tokenLimit
                            ? "bg-red-500"
                            : ((key.usedTokens || 0) / key.tokenLimit) > 0.8
                            ? "bg-amber-500"
                            : "bg-primary"
                        }`}
                        style={{ width: `${Math.min(100, Math.round(((key.usedTokens || 0) / key.tokenLimit) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  <button
                    onClick={() => handleOpenEditModal(key)}
                    className="p-1.5 hover:bg-primary/10 rounded text-text-muted hover:text-primary transition-all"
                    title="Edit Key & Permissions"
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
                    className="p-1.5 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                    title="Delete key"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
          setNewKeyTokenLimit("");
          setNewKeyModelMode("all");
          setNewKeyAllowedModels([]);
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Production Key, Alice, Dev Agent"
          />

          <div>
            <label className="text-xs text-text-muted mb-1 block font-medium">Token Limit (Quota)</label>
            <Input
              type="number"
              value={newKeyTokenLimit}
              onChange={(e) => setNewKeyTokenLimit(e.target.value)}
              placeholder="Leave empty or 0 for unlimited tokens"
              min="0"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Maximum total tokens this key can consume. Once reached, requests will return 429.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-muted font-medium block">Model Access Permissions</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewKeyModelMode("all")}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  newKeyModelMode === "all"
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">public</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight">All Models</div>
                  <div className="text-[10px] opacity-75 truncate">Full access, no restrictions</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setNewKeyModelMode("custom")}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  newKeyModelMode === "custom"
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">checklist</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight">Specific Models</div>
                  <div className="text-[10px] opacity-75 truncate">Whitelist / rule restricted</div>
                </div>
              </button>
            </div>

            {newKeyModelMode === "custom" && (
              <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-surface-2/60 border border-border mt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon="checklist"
                    onClick={() => setShowModelSelectForCreate(true)}
                    className="shrink-0 whitespace-nowrap text-xs h-8 px-3"
                  >
                    Select Models
                  </Button>

                  <div className="flex-1 relative flex items-center">
                    <input
                      type="text"
                      placeholder="Pattern (e.g. oc/*, gpt-4o)"
                      value={newKeyCustomPattern}
                      onChange={(e) => setNewKeyCustomPattern(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newKeyCustomPattern.trim()) {
                          e.preventDefault();
                          const p = newKeyCustomPattern.trim();
                          if (!newKeyAllowedModels.includes(p)) {
                            setNewKeyAllowedModels([...newKeyAllowedModels, p]);
                          }
                          setNewKeyCustomPattern("");
                        }
                      }}
                      className="w-full pl-2.5 pr-14 py-1.5 text-xs bg-surface border border-border rounded-lg placeholder:text-text-muted/60 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 font-mono h-8"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newKeyCustomPattern.trim()) {
                          const p = newKeyCustomPattern.trim();
                          if (!newKeyAllowedModels.includes(p)) {
                            setNewKeyAllowedModels([...newKeyAllowedModels, p]);
                          }
                          setNewKeyCustomPattern("");
                        }
                      }}
                      disabled={!newKeyCustomPattern.trim()}
                      className="absolute right-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs px-0.5">
                  <span className="text-[11px] font-medium text-text-muted">
                    Allowed items ({newKeyAllowedModels.length}):
                  </span>
                  {newKeyAllowedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setNewKeyAllowedModels([])}
                      className="text-[11px] text-text-muted hover:text-red-500 transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {newKeyAllowedModels.length === 0 ? (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                    <span className="material-symbols-outlined text-[15px] mt-0.5 shrink-0">warning</span>
                    <span className="text-[11px] leading-tight">
                      No models selected yet. All requests with this key will be rejected until you add at least one model or pattern.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-surface rounded-lg border border-border/70">
                    {newKeyAllowedModels.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-md text-xs font-mono text-primary"
                      >
                        <span>{m}</span>
                        <button
                          type="button"
                          onClick={() => setNewKeyAllowedModels(newKeyAllowedModels.filter((x) => x !== m))}
                          className="text-primary/60 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center w-3.5 h-3.5"
                          title="Remove"
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-text-muted">
                  Tip: Supports exact model IDs (<code>gpt-4o</code>), wildcards (<code>oc/*</code>), or sub-patterns (<code>*claude*</code>).
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-border">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
                setNewKeyTokenLimit("");
                setNewKeyModelMode("all");
                setNewKeyAllowedModels([]);
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Key Modal */}
      <Modal
        isOpen={!!editingKey}
        title={`Edit API Key: ${editingKey?.name || ""}`}
        onClose={() => !savingEdit && setEditingKey(null)}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={editKeyName}
            onChange={(e) => setEditKeyName(e.target.value)}
            placeholder="Key Name"
          />

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-muted block font-medium">Token Limit (Quota)</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                  Used: <strong className="text-text-main font-semibold">{editKeyUsedTokens.toLocaleString()}</strong> tokens
                </span>
                {editKeyUsedTokens > 0 && (
                  <button
                    type="button"
                    onClick={handleResetKeyTokens}
                    className="text-[11px] text-primary hover:underline font-medium cursor-pointer"
                  >
                    Reset Usage
                  </button>
                )}
              </div>
            </div>
            <Input
              type="number"
              value={editKeyTokenLimit}
              onChange={(e) => setEditKeyTokenLimit(e.target.value)}
              placeholder="0 or empty for unlimited"
              min="0"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Maximum total tokens this key can consume. Once reached, requests will return 429.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-muted font-medium block">Model Access Permissions</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditKeyModelMode("all")}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  editKeyModelMode === "all"
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">public</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight">All Models</div>
                  <div className="text-[10px] opacity-75 truncate">Full access, no restrictions</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEditKeyModelMode("custom")}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  editKeyModelMode === "custom"
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">checklist</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight">Specific Models</div>
                  <div className="text-[10px] opacity-75 truncate">Whitelist / rule restricted</div>
                </div>
              </button>
            </div>

            {editKeyModelMode === "custom" && (
              <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-surface-2/60 border border-border mt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon="checklist"
                    onClick={() => setShowModelSelectForEdit(true)}
                    className="shrink-0 whitespace-nowrap text-xs h-8 px-3"
                  >
                    Select Models
                  </Button>

                  <div className="flex-1 relative flex items-center">
                    <input
                      type="text"
                      placeholder="Pattern (e.g. oc/*, gpt-4o)"
                      value={editKeyCustomPattern}
                      onChange={(e) => setEditKeyCustomPattern(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editKeyCustomPattern.trim()) {
                          e.preventDefault();
                          const p = editKeyCustomPattern.trim();
                          if (!editKeyAllowedModels.includes(p)) {
                            setEditKeyAllowedModels([...editKeyAllowedModels, p]);
                          }
                          setEditKeyCustomPattern("");
                        }
                      }}
                      className="w-full pl-2.5 pr-14 py-1.5 text-xs bg-surface border border-border rounded-lg placeholder:text-text-muted/60 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 font-mono h-8"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (editKeyCustomPattern.trim()) {
                          const p = editKeyCustomPattern.trim();
                          if (!editKeyAllowedModels.includes(p)) {
                            setEditKeyAllowedModels([...editKeyAllowedModels, p]);
                          }
                          setEditKeyCustomPattern("");
                        }
                      }}
                      disabled={!editKeyCustomPattern.trim()}
                      className="absolute right-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs px-0.5">
                  <span className="text-[11px] font-medium text-text-muted">
                    Allowed items ({editKeyAllowedModels.length}):
                  </span>
                  {editKeyAllowedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditKeyAllowedModels([])}
                      className="text-[11px] text-text-muted hover:text-red-500 transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {editKeyAllowedModels.length === 0 ? (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                    <span className="material-symbols-outlined text-[15px] mt-0.5 shrink-0">warning</span>
                    <span className="text-[11px] leading-tight">
                      No models restricted yet. All models will be blocked unless you add at least one model or choose &quot;All Models&quot;.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-surface rounded-lg border border-border/70">
                    {editKeyAllowedModels.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-md text-xs font-mono text-primary"
                      >
                        <span>{m}</span>
                        <button
                          type="button"
                          onClick={() => setEditKeyAllowedModels(editKeyAllowedModels.filter((x) => x !== m))}
                          className="text-primary/60 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center w-3.5 h-3.5"
                          title="Remove"
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-text-muted">
                  Tip: Supports exact model IDs (<code>gpt-4o</code>), wildcards (<code>oc/*</code>), or sub-patterns (<code>*claude*</code>).
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-border">
            <Button onClick={handleUpdateKey} fullWidth disabled={savingEdit || !editKeyName.trim()}>
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              onClick={() => setEditingKey(null)}
              variant="ghost"
              fullWidth
              disabled={savingEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* ModelSelectModal for Create Key */}
      <ModelSelectModal
        isOpen={showModelSelectForCreate}
        onClose={() => setShowModelSelectForCreate(false)}
        activeProviders={activeProvidersList}
        title="Select Allowed Models for Key"
        closeOnSelect={false}
        addedModelValues={newKeyAllowedModels}
        onSelect={(model) => {
          const val = model?.value || model?.name || model;
          if (val && !newKeyAllowedModels.includes(val)) {
            setNewKeyAllowedModels([...newKeyAllowedModels, val]);
          }
        }}
        onDeselect={(model) => {
          const val = model?.value || model?.name || model;
          setNewKeyAllowedModels(newKeyAllowedModels.filter((x) => x !== val));
        }}
      />

      {/* ModelSelectModal for Edit Key */}
      <ModelSelectModal
        isOpen={showModelSelectForEdit}
        onClose={() => setShowModelSelectForEdit(false)}
        activeProviders={activeProvidersList}
        title="Select Allowed Models for Key"
        closeOnSelect={false}
        addedModelValues={editKeyAllowedModels}
        onSelect={(model) => {
          const val = model?.value || model?.name || model;
          if (val && !editKeyAllowedModels.includes(val)) {
            setEditKeyAllowedModels([...editKeyAllowedModels, val]);
          }
        }}
        onDeselect={(model) => {
          const val = model?.value || model?.name || model;
          setEditKeyAllowedModels(editKeyAllowedModels.filter((x) => x !== val));
        }}
      />

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

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Select, Modal, CardSkeleton, Toggle, ConfirmModal, ModelSelectModal, SegmentedControl } from "@/shared/components";
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

function formatTokensNumber(num) {
  if (!num || num <= 0) return "0";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString();
}

const RESET_INTERVAL_OPTIONS = [
  { value: "never", label: "Never reset" },
  { value: "5h", label: "Every 5 Hours (5h)" },
  { value: "7d", label: "Every 7 Days (7d)" },
  { value: "14d", label: "Every 14 Days (14d)" },
  { value: "30d", label: "Every 30 Days (30d)" },
  { value: "custom", label: "Custom Interval..." },
];

function generateSnippet(lang, apiKey, baseUrl) {
  const url = `${baseUrl}/v1/chat/completions`;
  const model = "gpt-4";
  if (lang === "curl") return `curl -X POST "${url}" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`;
  if (lang === "python") return `import requests\n\nresp = requests.post("${url}",\n headers={"Authorization": "Bearer ${apiKey}", "Content-Type": "application/json"},\n json={"model": "${model}", "messages": [{"role": "user", "content": "Hello"}]}\n)\nprint(resp.json())`;
  if (lang === "node") return `const resp = await fetch("${url}", {\n method: "POST",\n headers: { "Authorization": "Bearer ${apiKey}", "Content-Type": "application/json" },\n body: JSON.stringify({ model: "${model}", messages: [{ role: "user", content: "Hello" }] })\n});\nconst data = await resp.json();\nconsole.log(data);`;
  if (lang === "go") return `package main\n\nimport (\n\t"bytes"\n\t"fmt"\n\t"io"\n\t"net/http"\n)\n\nfunc main() {\n\tbody := []byte(\`{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}\`)\n\treq, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(body))\n\treq.Header.Set("Authorization", "Bearer ${apiKey}")\n\treq.Header.Set("Content-Type", "application/json")\n\tresp, _ := http.DefaultClient.Do(req)\n\tdefer resp.Body.Close()\n\tb, _ := io.ReadAll(resp.Body)\n\tfmt.Println(string(b))\n}`;
  return "";
}

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLimit, setNewKeyLimit] = useState("");
  const [newKeyReset, setNewKeyReset] = useState("never");
  const [newKeyCustomReset, setNewKeyCustomReset] = useState("");
  const [newKeyAllowedModels, setNewKeyAllowedModels] = useState("*");
  const [newKeyRpm, setNewKeyRpm] = useState("");
  const [newKeyTpm, setNewKeyTpm] = useState("");
  const [newKeyIpWhitelist, setNewKeyIpWhitelist] = useState("");
  const [newKeyExpiresAt, setNewKeyExpiresAt] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editReset, setEditReset] = useState("never");
  const [editCustomReset, setEditCustomReset] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState("*");
  const [editRpm, setEditRpm] = useState("");
  const [editTpm, setEditTpm] = useState("");
  const [editIpWhitelist, setEditIpWhitelist] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null); // 'create' | 'edit'
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [showSnippetModal, setShowSnippetModal] = useState(null); // key object or null
  const [snippetLang, setSnippetLang] = useState("curl");

  const [requireApiKey, setRequireApiKey] = useState(false);
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
  const [isRemoteHost] = useState(() => {
    if (typeof window === "undefined") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  });

  const { copied, copy } = useCopyToClipboard();

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

      const fetchProvidersAndAliases = async () => {
        try {
          const [providersRes, aliasesRes] = await Promise.all([
            fetch("/api/providers"),
            fetch("/api/models/alias"),
          ]);
          if (providersRes.ok) {
            const pData = await providersRes.json();
            setActiveProviders(pData.connections || []);
          }
          if (aliasesRes.ok) {
            const aData = await aliasesRes.json();
            setModelAliases(aData.aliases || {});
          }
        } catch (e) {
          console.error("Error fetching providers/aliases:", e);
        }
      };

      fetchProvidersAndAliases();

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

  const parseAllowedModelsList = (str) => {
    if (!str || str.trim() === "*" || str.trim() === "") return [];
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const handleSelectModelForPicker = (model) => {
    const modelVal = model.value;
    if (pickerTarget === "create") {
      const currentList = parseAllowedModelsList(newKeyAllowedModels);
      if (!currentList.includes(modelVal)) {
        const nextList = [...currentList, modelVal];
        setNewKeyAllowedModels(nextList.join(", "));
      }
    } else if (pickerTarget === "edit") {
      const currentList = parseAllowedModelsList(editAllowedModels);
      if (!currentList.includes(modelVal)) {
        const nextList = [...currentList, modelVal];
        setEditAllowedModels(nextList.join(", "));
      }
    }
  };

  const handleDeselectModelForPicker = (model) => {
    const modelVal = model.value;
    if (pickerTarget === "create") {
      const currentList = parseAllowedModelsList(newKeyAllowedModels);
      const nextList = currentList.filter((m) => m !== modelVal);
      setNewKeyAllowedModels(nextList.length === 0 ? "*" : nextList.join(", "));
    } else if (pickerTarget === "edit") {
      const currentList = parseAllowedModelsList(editAllowedModels);
      const nextList = currentList.filter((m) => m !== modelVal);
      setEditAllowedModels(nextList.length === 0 ? "*" : nextList.join(", "));
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
 const trimmedName = newKeyName.trim();
 if (keys.some((k) => k.name === trimmedName)) {
 alert(`A key named "${trimmedName}" already exists. Use a different name.`);
 return;
 }

    const limitNum = newKeyLimit ? Number(newKeyLimit) : 0;
    let finalReset = "never";
    if (limitNum > 0) {
      finalReset = newKeyReset === "custom" ? (newKeyCustomReset.trim() || "never") : newKeyReset;
    }

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName,
          tokenLimit: limitNum,
          resetInterval: finalReset,
          allowedModels: newKeyAllowedModels.trim() || "*",
          rpmLimit: newKeyRpm ? Number(newKeyRpm) : 0,
          tpmLimit: newKeyTpm ? Number(newKeyTpm) : 0,
          ipWhitelist: newKeyIpWhitelist.trim(),
          expiresAt: newKeyExpiresAt || null,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setNewKeyLimit("");
        setNewKeyReset("never");
        setNewKeyCustomReset("");
        setNewKeyAllowedModels("*");
        setNewKeyRpm("");
        setNewKeyTpm("");
        setNewKeyIpWhitelist("");
        setShowAddModal(false);
        setNewKeyExpiresAt("");
 } else {
 alert(data?.error || "Failed to create key");
 }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

 const handleDuplicateKey = (sourceKey) => {
 // Suggest a unique name like "X (copy)" / "X (copy 2)"
 let base = `${sourceKey.name} (copy)`;
 let candidate = base;
 let n = 2;
 while (keys.some((k) => k.name === candidate)) {
 candidate = `${base} ${n}`;
 n += 1;
 }
 setNewKeyName(candidate);
 setNewKeyLimit(sourceKey.tokenLimit ? String(sourceKey.tokenLimit) : "");
 const resVal = sourceKey.resetInterval || "never";
 if (["never", "5h", "7d", "14d", "30d"].includes(resVal)) {
 setNewKeyReset(resVal);
 setNewKeyCustomReset("");
 } else {
 setNewKeyReset("custom");
 setNewKeyCustomReset(resVal);
 }
 setNewKeyAllowedModels(sourceKey.allowedModels || "*");
 setNewKeyRpm(sourceKey.rpmLimit ? String(sourceKey.rpmLimit) : "");
 setNewKeyTpm(sourceKey.tpmLimit ? String(sourceKey.tpmLimit) : "");
 setNewKeyIpWhitelist(sourceKey.ipWhitelist || "");
 setNewKeyExpiresAt(sourceKey.expiresAt || "");
 setShowAddModal(true);
 };

  const handleUpdateKeyQuota = async (id, data) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingKey(null);
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody?.error || "Failed to update key");
      }
    } catch (error) {
      console.log("Error updating key:", error);
    }
  };

  const handleToggleKeyActive = async (key, isActive) => {
    const previous = key.isActive !== false;
    setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, isActive } : k)));
    try {
      const res = await fetch(`/api/keys/${key.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody?.error || "Failed to update the key state.");
        setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, isActive: previous } : k)));
      return;
    }
    } catch (error) {
      console.log("Error updating key state:", error);
      setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, isActive: previous } : k)));
    }
    await fetchData();
  };

  const handleManualResetUsage = async (key) => {
    setConfirmState({
      title: "Reset Token Usage",
      message: `Reset used tokens for "${key.name}" back to 0?`,
      onConfirm: async () => {
        setConfirmState(null);
        await handleUpdateKeyQuota(key.id, {
          usedTokens: 0,
          lastResetAt: new Date().toISOString(),
        });
      },
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

  const [baseUrl] = useState(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/v1`;
    }
    return "/v1";
  });

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
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] max-w-[140px] truncate text-center ${
              tunnelEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tunnel</span>
            {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
              <>
                <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 min-w-0 font-mono text-sm" inputClassName="truncate" />
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tunnelStatus.message}
                </div>
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              </>
            ) : tunnelChecking ? (
              <>
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
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
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] max-w-[140px] truncate text-center ${
              tsEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tailscale</span>
            {tsEnabled && !tsLoading && tsReachable ? (
              <>
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 min-w-0 font-mono text-sm" inputClassName="truncate" />
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
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
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
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
                  handleOpenTsModal();
                }}
                className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
              >
                Enable
              </Button>
            )}
          </div>
        </div>

        {/* Security warnings when tunnel or tailscale is active */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 flex flex-col gap-2">
            {!requireApiKey && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              className="flex-shrink-0"
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
              <Tooltip text="Open the dashboard through the tunnel or Tailscale URL (login still required), or keep it blocked when disabled" />
            </div>
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            API Keys
          </h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            className="flex-shrink-0"
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
                className={`group flex flex-wrap items-center justify-between gap-3 py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate min-w-0">{key.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 min-w-0">
                    <code className="text-xs text-text-muted font-mono truncate max-w-[200px] sm:max-w-xs min-w-0">
                      {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                    </code>
                    <button
                      onClick={() => toggleKeyVisibility(key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all flex-shrink-0"
                      title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                    <button
                      onClick={() => copy(key.key, key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all flex-shrink-0"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === key.id ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 overflow-hidden">
                    <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      Usage: {formatTokensNumber(key.usedTokens)} / {key.tokenLimit > 0 ? formatTokensNumber(key.tokenLimit) + " tokens" : "Unlimited"}
                    </span>
                    {key.tokenLimit > 0 && key.resetInterval && key.resetInterval !== "never" && (
                      <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-gray-500/10 text-text-muted">
                        Reset: every {key.resetInterval}
                      </span>
                    )}
                    <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                      Models: {key.allowedModels && key.allowedModels !== "*" ? key.allowedModels : "All"}
                    </span>
                    {(key.rpmLimit > 0 || key.tpmLimit > 0) && (
                      <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">
                        Rate: {key.rpmLimit > 0 ? `${key.rpmLimit} RPM` : ""}{key.rpmLimit > 0 && key.tpmLimit > 0 ? " · " : ""}{key.tpmLimit > 0 ? `${formatTokensNumber(key.tpmLimit)} TPM` : ""}
                      </span>
                    )}
                    {key.ipWhitelist && (
                      <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                        IP Guard: Active
                      </span>
                    )}
                    {key.tokenLimit > 0 && (key.usedTokens || 0) >= key.tokenLimit && (
                      <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-red-500/10 text-red-500 font-semibold">
                        Quota Exceeded
                      </span>
                    )}
                  </div>
                  {key.isActive === false && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs max-w-full truncate px-2 py-0.5 rounded bg-orange-500/10 text-orange-500 font-semibold">
                        Key switched off
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <div
                    className="inline-flex items-center px-1"
                    title={key.isActive === false ? "Switch this key back on" : "Switch this key off"}
                  >
                  <Toggle
                    size="sm"
                    checked={key.isActive !== false}
                    onChange={(nextActive) => handleToggleKeyActive(key, nextActive)}
                  />
                  </div>
                <button
                  onClick={() => {
                    setEditingKey(key);
                      setEditName(key.name || "");
                      const lim = key.tokenLimit ? String(key.tokenLimit) : "";
                      setEditLimit(lim);
                      const resVal = key.resetInterval || "never";
                      if (["never", "5h", "7d", "14d", "30d"].includes(resVal)) {
                        setEditReset(resVal);
                        setEditCustomReset("");
                      } else {
                        setEditReset("custom");
                        setEditCustomReset(resVal);
                      }
                      setEditAllowedModels(key.allowedModels || "*");
                      setEditRpm(key.rpmLimit ? String(key.rpmLimit) : "");
                      setEditTpm(key.tpmLimit ? String(key.tpmLimit) : "");
                      setEditIpWhitelist(key.ipWhitelist || "");
                      setEditExpiresAt(key.expiresAt || "");
                    }}
                    className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                    title="Edit key settings & quota"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
 <button
 onClick={() => handleDuplicateKey(key)}
 className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
 title="Duplicate key (copy settings)"
 >
 <span className="material-symbols-outlined text-[18px]">library_add</span>
 </button>
                  <button
                    onClick={() => handleManualResetUsage(key)}
                    className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                    title="Reset used tokens to 0"
                  >
                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                  </button>
          <button
            onClick={() => { setShowSnippetModal(key); setSnippetLang("curl"); }}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
            title="Code snippet"
          >
            <span className="material-symbols-outlined text-[18px]">code</span>
          </button>
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

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <Input
            label="Token Limit (0 for unlimited)"
            type="number"
            value={newKeyLimit}
            onChange={(e) => setNewKeyLimit(e.target.value)}
            placeholder="e.g. 88000000"
          />
 {Number(newKeyLimit) > 0 && (
 <Select
 label="Auto Reset Interval"
 options={RESET_INTERVAL_OPTIONS}
 value={newKeyReset}
 onChange={(e) => setNewKeyReset(e.target.value)}
 />
 )}
          {Number(newKeyLimit) > 0 && newKeyReset === "custom" && (
            <Input
              label="Custom Interval (e.g. 10h, 3d)"
              value={newKeyCustomReset}
              onChange={(e) => setNewKeyCustomReset(e.target.value)}
              placeholder="10h"
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="RPM Limit (0: unlimited)"
              type="number"
              value={newKeyRpm}
              onChange={(e) => setNewKeyRpm(e.target.value)}
              placeholder="0"
              hint="Max requests/min"
            />
            <Input
              label="TPM Limit (0: unlimited)"
              type="number"
              value={newKeyTpm}
              onChange={(e) => setNewKeyTpm(e.target.value)}
              placeholder="0"
              hint="Max tokens/min"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-main">
                Allowed Models
              </label>
              <Button
                size="sm"
                variant="ghost"
                icon="add"
                onClick={() => {
                  setPickerTarget("create");
                  setShowModelPicker(true);
                }}
              >
                Select Models
              </Button>
            </div>
            <Input
              value={newKeyAllowedModels}
              readOnly
              inputClassName="truncate font-mono"
              hint="Pick models with Select Models. * allows all models."
            />
            {parseAllowedModelsList(newKeyAllowedModels).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {parseAllowedModelsList(newKeyAllowedModels).map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-xs"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => handleDeselectModelForPicker({ value: m })}
                      className="hover:text-red-500 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Input
            label="IP Whitelist"
            value={newKeyIpWhitelist}
            onChange={(e) => setNewKeyIpWhitelist(e.target.value)}
            placeholder="e.g. 192.168.1.1, 103.20.10.5 (Leave empty to allow all)"
            hint="Leave empty to allow access from any IP address"
          />

 <Input
 label="Expiry Date (optional)"
 type="datetime-local"
 value={newKeyExpiresAt}
 onChange={(e) => setNewKeyExpiresAt(e.target.value)}
 hint="Key stops working after this date; leave empty for no expiry"
 />
          <div className="flex gap-2 w-full mt-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()} className="min-h-[44px]">
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
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
        onClose={() => setEditingKey(null)}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Production Key"
          />
          <Input
            label="Token Limit (0 for unlimited)"
            type="number"
            value={editLimit}
            onChange={(e) => setEditLimit(e.target.value)}
            placeholder="e.g. 88000000"
          />
 {Number(editLimit) > 0 && (
 <Select
 label="Auto Reset Interval"
 options={RESET_INTERVAL_OPTIONS}
 value={editReset}
 onChange={(e) => setEditReset(e.target.value)}
 />
 )}
          {Number(editLimit) > 0 && editReset === "custom" && (
            <Input
              label="Custom Interval (e.g. 10h, 3d)"
              value={editCustomReset}
              onChange={(e) => setEditCustomReset(e.target.value)}
              placeholder="10h"
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="RPM Limit (0: unlimited)"
              type="number"
              value={editRpm}
              onChange={(e) => setEditRpm(e.target.value)}
              placeholder="0"
              hint="Max requests/min"
            />
            <Input
              label="TPM Limit (0: unlimited)"
              type="number"
              value={editTpm}
              onChange={(e) => setEditTpm(e.target.value)}
              placeholder="0"
              hint="Max tokens/min"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-main">
                Allowed Models
              </label>
              <Button
                size="sm"
                variant="ghost"
                icon="add"
                onClick={() => {
                  setPickerTarget("edit");
                  setShowModelPicker(true);
                }}
              >
                Select Models
              </Button>
            </div>
            <Input
              value={editAllowedModels}
              readOnly
              inputClassName="truncate font-mono"
              hint="Pick models with Select Models. * allows all models."
            />
            {parseAllowedModelsList(editAllowedModels).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {parseAllowedModelsList(editAllowedModels).map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-xs"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => handleDeselectModelForPicker({ value: m })}
                      className="hover:text-red-500 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Input
            label="IP Whitelist"
            value={editIpWhitelist}
            onChange={(e) => setEditIpWhitelist(e.target.value)}
            placeholder="e.g. 192.168.1.1, 103.20.10.5 (Leave empty to allow all)"
            hint="Leave empty to allow access from any IP address"
          />

 <Input
 label="Expiry Date (optional)"
 type="datetime-local"
 value={editExpiresAt}
 onChange={(e) => setEditExpiresAt(e.target.value)}
 hint="Key stops working after this date; leave empty for no expiry"
 />
          <div className="flex gap-2 w-full mt-2">
            <Button
              onClick={() => {
                if (!editingKey) return;
                const limitNum = editLimit ? Number(editLimit) : 0;
                let finalReset = "never";
                if (limitNum > 0) {
                  finalReset = editReset === "custom" ? (editCustomReset.trim() || "never") : editReset;
                }
                handleUpdateKeyQuota(editingKey.id, {
                  name: editName.trim() || editingKey.name,
                  tokenLimit: limitNum,
                  resetInterval: finalReset,
                  allowedModels: editAllowedModels.trim() || "*",
                  rpmLimit: editRpm ? Number(editRpm) : 0,
                  tpmLimit: editTpm ? Number(editTpm) : 0,
                  ipWhitelist: editIpWhitelist.trim(),
                  expiresAt: editExpiresAt || null,
                });
              }}
              fullWidth
            >
              Save Changes
            </Button>
            <Button
              onClick={() => setEditingKey(null)}
              variant="ghost"
              fullWidth
            >
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
              Store this key now, because it is shown only once.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 min-w-0 font-mono text-sm" inputClassName="truncate"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              className="flex-shrink-0"
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

      {/* Model Select Modal for API Keys */}
      {showModelPicker && (
        <ModelSelectModal
          isOpen={showModelPicker}
          onClose={() => setShowModelPicker(false)}
          onSelect={handleSelectModelForPicker}
          onDeselect={handleDeselectModelForPicker}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Allowed Models"
          addedModelValues={parseAllowedModelsList(pickerTarget === "create" ? newKeyAllowedModels : editAllowedModels)}
          closeOnSelect={false}
        />
      )}

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
                  Expose your local 9Router to the internet without port forwarding or a static IP, then use the URL in Cursor, Cline, and other tools from anywhere.
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
            Needs outbound port 7844 (TCP/UDP) and may take 10-30s to connect.
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
          <p className="text-sm text-text-muted">The Cloudflare tunnel will disconnect and its URL will stop working.</p>
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
              <p className="text-sm text-text-muted">Install Tailscale to enable Funnel.</p>
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
          <p className="text-sm text-text-muted">Tailscale Funnel will stop and its URL will become unreachable.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Snippet Modal */}
<Modal
  isOpen={!!showSnippetModal}
  title="Code Snippet"
  onClose={() => setShowSnippetModal(null)}
>
  <div className="flex flex-col gap-4">
 <SegmentedControl
 options={[
 { value: "curl", label: "cURL" },
 { value: "python", label: "Python" },
 { value: "node", label: "Node.js" },
 { value: "go", label: "Go" },
 ]}
 value={snippetLang}
 onChange={setSnippetLang}
 size="sm"
 className="w-full sm:w-auto"
 />
    <pre className="bg-surface-2 border border-border/50 rounded-[10px] p-4 text-xs text-text-main font-mono overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
      {showSnippetModal && generateSnippet(snippetLang, showSnippetModal.key, typeof window !== "undefined" ? window.location.origin : "")}
    </pre>
    <Button
      onClick={() => {
        if (showSnippetModal) {
          const text = generateSnippet(snippetLang, showSnippetModal.key, typeof window !== "undefined" ? window.location.origin : "");
          navigator.clipboard.writeText(text);
        }
      }}
      icon="content_copy"
      fullWidth
    >
      Copy to Clipboard
    </Button>
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

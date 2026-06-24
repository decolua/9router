"use client";

import React, { useState, useEffect, useRef, useCallback, ComponentType, ButtonHTMLAttributes } from "react";
import { Card, Button, Input, Modal, CardSkeleton, Toggle } from "@/shared/components";
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

// ---------------------------------------------------------------------------
// Typed component shims — cast shared components to permissive prop shapes
// ---------------------------------------------------------------------------

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  size?: string;
  icon?: string;
  iconRight?: string;
  fullWidth?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

interface InpProps {
  value?: string;
  readOnly?: boolean;
  className?: string;
  label?: string;
  placeholder?: string;
  type?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface ModProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: string;
  closeOnOverlay?: boolean;
  showTrafficLights?: boolean;
  className?: string;
}

interface TogProps {
  checked?: boolean;
  onChange: () => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: string;
  className?: string;
}

interface CardProps {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  icon?: string;
  action?: React.ReactNode;
  padding?: string;
  hover?: boolean;
  elev?: boolean;
  className?: string;
}

const Btn = Button as ComponentType<BtnProps>;
const Inp = Input as ComponentType<InpProps>;
const Mod = Modal as ComponentType<ModProps>;
const Tog = Toggle as ComponentType<TogProps>;
const Crd = Card as ComponentType<CardProps>;

interface EndpointRowProps {
  label?: string;
  url?: string;
  copyId?: string;
  copied?: string | null;
  onCopy?: (text: string, id?: string) => void;
  badge?: string;
  actions?: React.ReactNode;
}

const EpRow = EndpointRow as ComponentType<EndpointRowProps>;

// ---------------------------------------------------------------------------
// JsonValue helpers
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function asJson(v: unknown): JsonValue {
  return v as JsonValue;
}

function strOf(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function numOf(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function boolOf(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function recOf(v: unknown): Record<string, JsonValue> {
  return (v && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, JsonValue>) : {};
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

interface TunnelStatus {
  type: "error" | "success" | "info";
  message: string;
}

interface TailscaleStatus {
  type: "error" | "success" | "info";
  message: string;
}

interface TunnelApiData {
  settingsEnabled?: boolean;
  enabled?: boolean;
  tunnelUrl?: string;
  publicUrl?: string;
}

interface TailscaleApiData {
  settingsEnabled?: boolean;
  enabled?: boolean;
  tunnelUrl?: string;
  authUrl?: string;
  hostname?: string;
  installed?: boolean;
}

interface DownloadApiData {
  downloading?: boolean;
  progress?: number;
}

interface TunnelStatusApiResponse {
  tunnel?: TunnelApiData;
  tailscale?: TailscaleApiData;
  download?: DownloadApiData;
}

interface SettingsApiResponse {
  requireApiKey?: boolean;
  requireLogin?: boolean;
  hasPassword?: boolean;
  tunnelDashboardAccess?: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  machineId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EndpointPageClient(props: Props) {
  // General
  const [loading, setLoading] = useState<boolean>(true);
  const [requireApiKey, setRequireApiKey] = useState<boolean>(false);
  const [requireLogin, setRequireLogin] = useState<boolean>(true);
  const [hasPassword, setHasPassword] = useState<boolean>(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState<boolean>(false);

  // Cloudflare Tunnel
  const [tunnelChecking, setTunnelChecking] = useState<boolean>(true);
  const [tunnelEnabled, setTunnelEnabled] = useState<boolean>(false);
  const [tunnelReachable, setTunnelReachable] = useState<boolean>(false);
  const [tunnelUrl, setTunnelUrl] = useState<string>("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState<string>("");
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelProgress, setTunnelProgress] = useState<string>("");
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState<boolean>(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState<boolean>(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState<boolean>(false);

  // Tailscale
  const [tsEnabled, setTsEnabled] = useState<boolean>(false);
  const [tsReachable, setTsReachable] = useState<boolean>(false);
  const [tsUrl, setTsUrl] = useState<string>("");
  const [tsLoading, setTsLoading] = useState<boolean>(false);
  const [tsProgress, setTsProgress] = useState<string>("");
  const [tsStatus, setTsStatus] = useState<TailscaleStatus | null>(null);
  const [tsAuthUrl, setTsAuthUrl] = useState<string>("");
  const [tsAuthLabel, setTsAuthLabel] = useState<string>("");
  const [tsInstalled, setTsInstalled] = useState<boolean | null>(null);
  const [tsInstalling, setTsInstalling] = useState<boolean>(false);
  const [tsInstallLog, setTsInstallLog] = useState<string[]>([]);
  const [tsSudoPassword, setTsSudoPassword] = useState<string>("");
  const [tsConnecting, setTsConnecting] = useState<boolean>(false);
  const [showTsModal, setShowTsModal] = useState<boolean>(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState<boolean>(false);
  const [tsEverReachable, setTsEverReachable] = useState<boolean>(false);

  // Refs
  const tsLogRef = useRef<HTMLDivElement | null>(null);
  const tunnelMissRef = useRef<number>(0);
  const tsMissRef = useRef<number>(0);
  const tunnelClientReachableRef = useRef<boolean>(false);
  const tsClientReachableRef = useRef<boolean>(false);
  const tunnelEverReachableRef = useRef<boolean>(false);
  const tsEverReachableRef = useRef<boolean>(false);

  const { copied, copy } = useCopyToClipboard();

  // Derived
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  const updateReachable = useCallback(
    (
      _unused: unknown,
      clientRef: React.MutableRefObject<boolean>,
      missRef: React.MutableRefObject<number>,
      setter: (v: boolean) => void,
      everRef: React.MutableRefObject<boolean>,
      everSetter: (v: boolean) => void,
    ) => {
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
    },
    [],
  );

  const syncTunnelStatus = useCallback(async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data: TunnelStatusApiResponse = await statusRes.json() as TunnelStatusApiResponse;
      const tEnabled = boolOf(data.tunnel?.settingsEnabled ?? data.tunnel?.enabled);
      const tUrl = strOf(data.tunnel?.tunnelUrl);
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(strOf(data.tunnel?.publicUrl));
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      const tsEn = boolOf(data.tailscale?.settingsEnabled ?? data.tailscale?.enabled);
      const tsUrlVal = strOf(data.tailscale?.tunnelUrl);
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
    } catch { /* ignore poll errors */ }
  }, [updateReachable]);

  const loadSettings = useCallback(async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status", { cache: "no-store" }),
      ]);
      if (settingsRes.ok) {
        const s: SettingsApiResponse = await settingsRes.json() as SettingsApiResponse;
        setRequireApiKey(boolOf(s.requireApiKey));
        setRequireLogin(boolOf(s.requireLogin, true));
        setHasPassword(boolOf(s.hasPassword, true));
        setTunnelDashboardAccess(boolOf(s.tunnelDashboardAccess));
      }
      if (statusRes.ok) {
        const data: TunnelStatusApiResponse = await statusRes.json() as TunnelStatusApiResponse;
        const tEnabled = boolOf(data.tunnel?.settingsEnabled ?? data.tunnel?.enabled);
        setTunnelEnabled(tEnabled);
        setTunnelUrl(strOf(data.tunnel?.tunnelUrl));
        setTunnelPublicUrl(strOf(data.tunnel?.publicUrl));
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        const tsEn = boolOf(data.tailscale?.settingsEnabled ?? data.tailscale?.enabled);
        setTsEnabled(tsEn);
        setTsUrl(strOf(data.tailscale?.tunnelUrl));
        setTsAuthUrl(strOf(data.tailscale?.authUrl));
        setTsAuthLabel(strOf(data.tailscale?.hostname));
        const installed = data.tailscale?.installed;
        setTsInstalled(installed == null ? null : boolOf(installed));
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
      }
    } catch { /* ignore */ } finally {
      setTunnelChecking(false);
      setLoading(false);
    }
  }, [updateReachable]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  // Initial load
  useEffect(() => {
    Promise.resolve().then(() => loadSettings());
  }, [loadSettings]);

  // Status poll while degraded + visibility re-check
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
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable, syncTunnelStatus]);

  // Browser-side client ping
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) {
          tunnelMissRef.current = 0;
          setTunnelReachable(true);
          if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); }
        } else {
          tunnelMissRef.current += 1;
          if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false);
        }
      } else {
        tunnelClientReachableRef.current = false;
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) {
          tsMissRef.current = 0;
          setTsReachable(true);
          if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); }
        } else {
          tsMissRef.current += 1;
          if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false);
        }
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

  // ---------------------------------------------------------------------------
  // Handlers — settings
  // ---------------------------------------------------------------------------

  const handleTunnelDashboardAccess = async (value: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (err) {
      console.error("Error updating tunnelDashboardAccess:", err);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers — Cloudflare Tunnel
  // ---------------------------------------------------------------------------

  const pingTunnelHealth = async (...urls: string[]): Promise<boolean> => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise<void>((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(
        targets.map(async (h) => {
          const p = await fetch(h, { mode: "cors", cache: "no-store" });
          if (p.ok) return true;
          throw new Error("not ready");
        }),
      ).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json() as TunnelStatusApiResponse;
            if (!boolOf(status.tunnel?.enabled)) {
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
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json() as TunnelStatusApiResponse;
            if (boolOf((s.download as DownloadApiData | undefined)?.downloading)) {
              setTunnelProgress(`Downloading cloudflared... ${numOf((s.download as DownloadApiData | undefined)?.progress)}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();
    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json() as JsonValue;
      const rec = recOf(data);
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: strOf(rec.error, "Failed to enable tunnel") });
        return;
      }
      const url = strOf(rec.tunnelUrl);
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }
      setTunnelUrl(url);
      setTunnelPublicUrl(strOf(rec.publicUrl));
      await pingTunnelHealth(strOf(rec.publicUrl), url);
    } catch (err) {
      setTunnelStatus({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
      const data = recOf(await res.json() as JsonValue);
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: strOf(data.error, "Failed to disable tunnel") });
      }
    } catch (err) {
      setTunnelStatus({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTunnelLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers — Tailscale
  // ---------------------------------------------------------------------------

  const checkTailscaleInstalled = async (): Promise<{ installed: boolean; hasCachedPassword?: boolean }> => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = recOf(await res.json() as JsonValue);
        const installed = boolOf(data.installed);
        setTsInstalled(installed);
        return { installed, hasCachedPassword: boolOf(data.hasCachedPassword) };
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const pingTsHealth = async (url: string): Promise<boolean> => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise<void>((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready */ }
    }
    return false;
  };

  const requestUserAuth = (url: string, label: string) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const pollFunnelEnable = async (enableUrl: string) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress('Click "Open Funnel Settings" to enable Funnel...');
    for (let i = 0; i < 40; i++) {
      await new Promise<void>((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = recOf(await res.json() as JsonValue);
        if (res.ok && boolOf(data.success)) {
          clearUserAuth();
          const urlVal = strOf(data.tunnelUrl);
          setTsUrl(urlVal);
          const ok = await pingTsHealth(urlVal);
          setTsEnabled(true);
          setTsStatus(ok ? null : { type: "info", message: "Connected but not reachable yet." });
          return;
        }
        if (boolOf(data.funnelNotEnabled)) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: strOf(data.error) });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
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
      const data = recOf(await res.json() as JsonValue);
      if (res.ok && boolOf(data.success)) {
        const urlVal = strOf(data.tunnelUrl);
        setTsUrl(urlVal);
        const reachable = await pingTsHealth(urlVal);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "info", message: "Connected but not reachable yet." });
        return;
      }
      if (boolOf(data.needsLogin) && data.authUrl) {
        requestUserAuth(strOf(data.authUrl), "Open Login Page");
        setTsProgress('Login required — click "Open Login Page" to continue');
        for (let i = 0; i < 40; i++) {
          await new Promise<void>((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = recOf(await r2.json() as JsonValue);
              if (boolOf(check.loggedIn)) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = recOf(await res2.json() as JsonValue);
                if (res2.ok && boolOf(data2.success)) {
                  const urlVal2 = strOf(data2.tunnelUrl);
                  setTsUrl(urlVal2);
                  const ok2 = await pingTsHealth(urlVal2);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "info", message: "Connected but not reachable yet." });
                } else if (boolOf(data2.funnelNotEnabled) && data2.enableUrl) {
                  await pollFunnelEnable(strOf(data2.enableUrl));
                } else {
                  setTsStatus({ type: "error", message: strOf(data2.error, "Failed to start funnel") });
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
      if (boolOf(data.funnelNotEnabled) && data.enableUrl) {
        await pollFunnelEnable(strOf(data.enableUrl));
        return;
      }
      setTsStatus({ type: "error", message: strOf(data.error, "Failed to connect") });
    } catch (err) {
      setTsStatus({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
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
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let payload: Record<string, JsonValue> = {};
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { payload = recOf(JSON.parse(line.slice(6)) as JsonValue); } catch { /* skip */ }
            }
          }
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), strOf(payload.message)]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: strOf(payload.error, "Install failed") });
          }
        }
      }
    } catch (err) {
      setTsStatus({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTsInstalling(false);
    }
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = recOf(await res.json() as JsonValue);
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: strOf(data.error, "Failed to disable Tailscale") });
      }
    } catch (err) {
      setTsStatus({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data.installed && data.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/v1`;

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Crd>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>

        {/* Endpoint rows */}
        <div className="flex flex-col gap-2">
          {/* Local */}
          <EpRow
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
                <Inp value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
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
                <Btn size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Btn>
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
              <Btn
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
              </Btn>
            )}
          </div>

          {/* Tailscale */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
              tsEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tailscale</span>
            {tsEnabled && !tsLoading && tsReachable ? (
              <>
                <Inp value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
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
                  <Btn
                    size="sm"
                    icon="open_in_new"
                    onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                  >
                    {tsAuthLabel || "Open"}
                  </Btn>
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
                <Btn size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Btn>
              </>
            ) : (
              <Btn
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
              </Btn>
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
                action={{ label: "Enable", href: "/dashboard/system/api-keys" }}
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
            <Tog
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
            </div>
          </div>
        )}
      </Crd>

      {/* Enable Tunnel Modal */}
      <Mod
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
            <Btn onClick={handleEnableTunnel} fullWidth>Start Tunnel</Btn>
            <Btn onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Btn>
          </div>
        </div>
      </Mod>

      {/* Disable Cloudflare Tunnel Modal */}
      <Mod
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Btn onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Btn>
            <Btn onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Btn>
          </div>
        </div>
      </Mod>

      {/* Tailscale Modal */}
      <Mod
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

          {/* Not installed — show sudo password input + install button */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <Inp
                type="password"
                placeholder="Sudo password (optional)"
                value={tsSudoPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTsSudoPassword(e.target.value)}
              />
              <div className="flex gap-2">
                <Btn onClick={handleInstallTailscale} fullWidth>Install Tailscale</Btn>
                <Btn onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Btn>
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
                <Btn onClick={() => handleConnectTailscale()} fullWidth>Connect</Btn>
                <Btn onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Btn>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Mod>

      {/* Disable Tailscale Modal */}
      <Mod
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Btn onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Btn>
            <Btn onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Btn>
          </div>
        </div>
      </Mod>
    </div>
  );
}

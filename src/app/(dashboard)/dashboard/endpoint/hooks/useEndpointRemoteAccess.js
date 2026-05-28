"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkTailscaleInstalled as checkTailscaleInstalledRequest,
  disableTailscale,
  disableTunnel,
  enableTailscale,
  enableTunnel,
  fetchTunnelStatus,
  installTailscale,
} from "../services/endpointApiService";
import {
  clientPingAny,
  clientPingUrl,
} from "../services/endpointHealthService";
import {
  CLIENT_PING_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  STATUS_POLL_FAST_MS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
} from "../utils/endpointConstants";

export function useEndpointRemoteAccess({
  requireApiKey,
  requireLogin,
  hasPassword,
  applySettings,
}) {
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

  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null);
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);

  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? 'Enable "Require login" and set a custom password before activating the tunnel.'
    : "Change the default dashboard password before activating the tunnel.";

  const updateReachable = useCallback(
    (_unused, clientRef, missRef, setter, everRef, everSetter) => {
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

  const applyTunnelStatus = useCallback(
    (data) => {
      const tEnabled =
        data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelEnabled(tEnabled);
      updateReachable(
        null,
        tunnelClientReachableRef,
        tunnelMissRef,
        setTunnelReachable,
        tunnelEverReachableRef,
        setTunnelEverReachable,
      );

      const tsEn =
        data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
      const tsUrlVal = data.tailscale?.tunnelUrl || "";
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(
        null,
        tsClientReachableRef,
        tsMissRef,
        setTsReachable,
        tsEverReachableRef,
        setTsEverReachable,
      );
    },
    [updateReachable],
  );

  const syncTunnelStatus = useCallback(async () => {
    try {
      const { ok, data } = await fetchTunnelStatus();
      if (!ok) return;
      applyTunnelStatus(data);
    } catch {
      /* ignore poll errors */
    }
  }, [applyTunnelStatus]);

  const loadInitialState = useCallback(async () => {
    try {
      await applySettings();
      const { ok, data } = await fetchTunnelStatus();
      if (ok) applyTunnelStatus(data);
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  }, [applySettings, applyTunnelStatus]);

  useEffect(() => {
    queueMicrotask(() => {
      loadInitialState();
    });
  }, [loadInitialState]);

  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => {
      if (!document.hidden) syncTunnelStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy)
      return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (!document.hidden) syncTunnelStatus();
    }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    tunnelEnabled,
    tsEnabled,
    tunnelReachable,
    tsReachable,
    syncTunnelStatus,
  ]);

  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) {
          tunnelMissRef.current = 0;
          setTunnelReachable(true);
          if (!tunnelEverReachableRef.current) {
            tunnelEverReachableRef.current = true;
            setTunnelEverReachable(true);
          }
        } else {
          tunnelMissRef.current += 1;
          if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD)
            setTunnelReachable(false);
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
          if (!tsEverReachableRef.current) {
            tsEverReachableRef.current = true;
            setTsEverReachable(true);
          }
        } else {
          tsMissRef.current += 1;
          if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD)
            setTsReachable(false);
        }
      } else {
        tsClientReachableRef.current = false;
      }
    };
    const anyEnabled =
      (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [
    tunnelEnabled,
    tunnelUrl,
    tunnelPublicUrl,
    tsEnabled,
    tsUrl,
    tunnelReachable,
    tsReachable,
  ]);

  const openEnableTunnelModal = () => {
    if (isLoginUnsafe) {
      setTunnelStatus({
        type: "error",
        message: `Security required: ${unsafeReason}`,
      });
      return;
    }
    if (!requireApiKey) {
      setTunnelStatus({
        type: "error",
        message:
          'Security required: Enable "Require API key" before activating the tunnel.',
      });
      return;
    }
    setShowEnableTunnelModal(true);
  };

  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
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
          const { ok: statusOk, data: status } = await fetchTunnelStatus();
          if (statusOk && !status.tunnel?.enabled) {
            setTunnelStatus({
              type: "error",
              message: "Tunnel process stopped unexpectedly.",
            });
            setTunnelLoading(false);
            setTunnelProgress("");
            return false;
          }
        } catch {
          /* ignore */
        }
      }
    }
    setTunnelStatus({
      type: "error",
      message: "Tunnel created but not reachable. Please try again.",
    });
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
          const { ok, data: s } = await fetchTunnelStatus();
          if (ok) {
            if (s.download?.downloading) {
              setTunnelProgress(
                `Downloading cloudflared... ${s.download.progress}%`,
              );
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const { ok, data } = await enableTunnel();
      polling = false;
      if (!ok) {
        setTunnelStatus({
          type: "error",
          message: data.error || "Failed to enable tunnel",
        });
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
      const { ok, data } = await disableTunnel();
      if (ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({
          type: "error",
          message: data.error || "Failed to disable tunnel",
        });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const { ok, data } = await checkTailscaleInstalledRequest();
      if (ok) {
        setTsInstalled(data.installed);
        return data;
      }
    } catch {
      /* ignore */
    }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await installTailscale(tsSudoPassword);
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
              try {
                data = JSON.parse(line.slice(6));
              } catch {
                /* skip */
              }
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
            setTsStatus({
              type: "error",
              message: data.error || "Install failed",
            });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, {
          mode: "no-cors",
          cache: "no-store",
        });
        if (ping.ok || ping.type === "opaque") return true;
      } catch {
        /* not ready yet */
      }
    }
    return false;
  };

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
      const { ok, data } = await enableTailscale();

      if (ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(
          reachable
            ? null
            : { type: "warning", message: "Connected but not reachable yet." },
        );
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress('Login required — click "Open Login Page" to continue');
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const { ok: checkOk, data: check } =
              await checkTailscaleInstalledRequest();
            if (checkOk && check.loggedIn) {
              clearUserAuth();
              setTsProgress("Starting funnel...");
              const { ok: ok2Response, data: data2 } = await enableTailscale();
              if (ok2Response && data2.success) {
                setTsUrl(data2.tunnelUrl || "");
                const ok2 = await pingTsHealth(data2.tunnelUrl);
                setTsEnabled(true);
                setTsStatus(
                  ok2
                    ? null
                    : {
                        type: "warning",
                        message: "Connected but not reachable yet.",
                      },
                );
              } else if (data2.funnelNotEnabled && data2.enableUrl) {
                await pollFunnelEnable(data2.enableUrl);
              } else {
                setTsStatus({
                  type: "error",
                  message: data2.error || "Failed to start funnel",
                });
              }
              return;
            }
          } catch {
            /* retry */
          }
        }
        clearUserAuth();
        setTsStatus({
          type: "error",
          message: "Login timed out. Please try again.",
        });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({
        type: "error",
        message: data.error || "Failed to connect",
      });
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
    setTsProgress('Click "Open Funnel Settings" to enable Funnel...');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const { ok, data } = await enableTailscale();
        if (ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(
            ok3
              ? null
              : {
                  type: "warning",
                  message: "Connected but not reachable yet.",
                },
          );
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch {
        /* retry */
      }
    }
    clearUserAuth();
    setTsStatus({
      type: "error",
      message: "Timed out waiting for Funnel to be enabled.",
    });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const { ok, data } = await disableTailscale();
      if (ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({
          type: "error",
          message: data.error || "Failed to disable Tailscale",
        });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    if (isLoginUnsafe) {
      setTsStatus({
        type: "error",
        message: `Security required: ${unsafeReason}`,
      });
      return;
    }
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  const stopTunnelLoading = () => {
    setTunnelLoading(false);
    setTunnelProgress("");
  };

  const stopTailscaleLoading = () => {
    setTsLoading(false);
    setTsConnecting(false);
    setTsProgress("");
    clearUserAuth();
  };

  const closeTsModal = () => {
    if (tsInstalling) return;
    setShowTsModal(false);
    setTsSudoPassword("");
    setTsStatus(null);
  };

  return {
    tunnelChecking,
    tunnelEnabled,
    tunnelReachable,
    tunnelUrl,
    tunnelPublicUrl,
    tunnelLoading,
    tunnelProgress,
    tunnelStatus,
    showEnableTunnelModal,
    showDisableTunnelModal,
    tsEnabled,
    tsReachable,
    tsUrl,
    tsLoading,
    tsProgress,
    tsStatus,
    tsAuthUrl,
    tsAuthLabel,
    tsInstalled,
    tsInstalling,
    tsInstallLog,
    tsSudoPassword,
    tsConnecting,
    showTsModal,
    showDisableTsModal,
    tunnelEverReachable,
    tsEverReachable,
    isLoginUnsafe,
    unsafeReason,
    setTunnelChecking,
    setTunnelStatus,
    setShowEnableTunnelModal,
    setShowDisableTunnelModal,
    setTsStatus,
    setShowTsModal,
    setShowDisableTsModal,
    setTsSudoPassword,
    handleEnableTunnel,
    handleDisableTunnel,
    handleInstallTailscale,
    handleConnectTailscale,
    handleDisableTailscale,
    handleOpenTsModal,
    openEnableTunnelModal,
    stopTunnelLoading,
    stopTailscaleLoading,
    closeTsModal,
  };
}

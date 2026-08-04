"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";

export default function MuxClient() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVpsWarning, setShowVpsWarning] = useState(true);
  const [isBarCollapsed, setIsBarCollapsed] = useState(false);

  // Install states
  const [installStatus, setInstallStatus] = useState({
    state: "idle",
    progress: 0,
    log: [],
    error: null,
  });

  // Form states for config
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(20130);
  const [authToken, setAuthToken] = useState("");
  const [noAuth, setNoAuth] = useState(true);
  const [muxPath, setMuxPath] = useState("");

  const iframeRef = useRef(null);
  const logEndRef = useRef(null);

  // Auto scroll terminal logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [installStatus.log]);

  // Load status and config
  const loadStatus = async (autoStart = false) => {
    try {
      const res = await fetch("/api/mux");
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setStats(data.stats);
        setRunning(data.stats.running);
        if (data.installStatus) {
          setInstallStatus(data.installStatus);
        }

        // Populate form fields
        setHost(data.config.host);
        setPort(data.config.port);
        setAuthToken(data.config.authToken);
        setNoAuth(data.config.noAuth);
        setMuxPath(data.config.muxPath);

        // Auto-start if installed and not running
        if (data.stats.installed && !data.stats.running && autoStart) {
          await handleStart();
        } else {
          setLoading(false);
        }
      } else {
        setErrorMsg("Failed to retrieve Mux status");
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to connect to backend server");
      setLoading(false);
    }
  };

  // Start server
  const handleStart = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/mux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (data.success) {
        // Wait a second for server to initialize
        setTimeout(() => {
          loadStatus(false);
        }, 1500);
      } else {
        setErrorMsg(data.message || "Failed to start Mux server");
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Error starting Mux server");
      setLoading(false);
    }
  };

  // Stop server
  const handleStop = async () => {
    try {
      const res = await fetch("/api/mux", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setRunning(false);
        setStats((prev) => prev ? { ...prev, running: false } : null);
      }
    } catch (err) {
      console.error("Failed to stop Mux:", err);
    }
  };

  // Restart server
  const handleRestart = async () => {
    await handleStop();
    setTimeout(() => {
      handleStart();
    }, 1000);
  };

  // Save Settings
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const newConfig = { host, port, authToken, noAuth, muxPath };
      const res = await fetch("/api/mux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", config: newConfig }),
      });
      const data = await res.json();
      if (data.success) {
        setShowSettings(false);
        // Automatically restart to apply new parameters
        handleRestart();
      } else {
        alert("Failed to save configuration");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving config");
    }
  };

  // Install trigger
  const handleInstall = async () => {
    setErrorMsg(null);
    try {
      const res = await fetch("/api/mux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install" }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.message || "Failed to trigger Mux installation");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Error starting Mux installation");
    }
  };

  // Cancel Installation trigger
  const handleCancelInstall = async () => {
    try {
      const res = await fetch("/api/mux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_install" }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("Failed to cancel installation");
      }
    } catch (err) {
      console.error(err);
      alert("Error cancelling installation");
    }
  };

  // Delete Mux trigger
  const handleDeleteMux = async () => {
    const confirmDelete = confirm(
      "Are you absolutely sure you want to delete Mux? This will recursively remove the cloned repository, packages, and build outputs from the disk with no trace."
    );
    if (!confirmDelete) return;

    setLoading(true);
    try {
      const res = await fetch("/api/mux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_mux" }),
      });
      const data = await res.json();
      if (data.success) {
        setShowSettings(false);
        setStats(null);
        setRunning(false);
        loadStatus(false);
      } else {
        alert(data.error || "Failed to delete Mux integration");
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting Mux");
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadStatus(true);
  }, []);

  // Poll stats and install progress continuously (every 4 seconds to reduce request frequency)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/mux");
        const data = await res.json();
        if (data.success) {
          setStats(data.stats);
          setRunning(data.stats.running);
          if (data.installStatus) {
            setInstallStatus(data.installStatus);
          }
          if (data.stats.running) {
            setLoading(false);
          }
        }
      } catch (err) {
        console.error("Error polling Mux stats:", err);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Format bytes to MB
  const formatMB = (bytes) => {
    if (!bytes) return "0 MB";
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  // Format system memory percent
  const getSysMemPercent = () => {
    if (!stats?.system?.memory) return 0;
    const { total, used } = stats.system.memory;
    return Math.round((used / total) * 100);
  };

  const getIframeUrl = () => {
    if (!config) return "";
    let displayHost = config.host || "0.0.0.0";

    if (typeof window !== "undefined") {
      const currentHost = window.location.hostname;
      const isLocalPage = currentHost === "localhost" || currentHost === "127.0.0.1" || currentHost === "[::1]";

      if (!isLocalPage) {
        // If loaded remotely on a VPS, map wildcard/localhost to the actual VPS IP
        if (config.host === "127.0.0.1" || config.host === "localhost" || config.host === "0.0.0.0") {
          displayHost = currentHost;
        }
      } else {
        // If loaded locally but bound to wildcard, resolve to loopback
        if (config.host === "0.0.0.0") {
          displayHost = "127.0.0.1";
        }
      }
    }

    return `http://${displayHost}:${config.port}/${config.noAuth ? "" : `?token=${config.authToken}`}`;
  };

  const iframeUrl = getIframeUrl();

  const isInstalling = ["cloning", "installing_dependencies", "building"].includes(installStatus.state);
  // While actively installing, always show install UI regardless of partial file state on disk
  const isInstalled = !isInstalling && (stats?.installed || installStatus.state === "completed");

  const isRemote = typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    window.location.hostname !== "[::1]";

  // 1. Show installation interface if not installed
  if (!isInstalled) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)] w-full text-[#E2E8F0] p-6 overflow-y-auto bg-black">
        <div className="max-w-4xl mx-auto w-full space-y-6">
          {/* Header section with deep dark colors */}
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-6 mb-2">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white shadow-xl">
              <span className="material-symbols-outlined text-[36px] text-white">smart_toy</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Mux Agent Integration</h1>
              <p className="text-zinc-400 mt-1 text-sm">Orchestrate and run parallel AI sub-agents directly inside your workspace</p>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto w-full mb-6">
          <div className="flex items-start gap-3 px-5 py-4 rounded-xl border border-red-500/25 bg-red-900/10 text-red-200 text-xs shadow-lg">
            <span className="material-symbols-outlined text-[20px] text-red-400 shrink-0 mt-0.5 animate-pulse">warning</span>
            <div>
              <h4 className="font-bold text-red-400 text-sm mb-1">
                VPS Support is Experimental And Not Working Currently - Start making PRs and contributions for more optimization, fixes, and compatibility
              </h4>
              <p className="leading-relaxed">
                Do not attempt to use Mux on a remote VPS yet. It is not fully optimized for remote deployment and may fail due to connection latencies and firewall configurations. Mux is currently only supported and experimental on <strong className="text-white font-semibold">localhost</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Always show terminal if we have logs or are actively installing/failed */}
        {(isInstalling || installStatus.state === "failed" || installStatus.state === "completed" || installStatus.log.length > 0) ? (
          <div className="space-y-4">
            {/* Progress bar (shown while installing) */}
            {(isInstalling || installStatus.state === "failed") && (
              <div className="bg-[#0c0e17] border border-zinc-800 rounded-xl mt-2 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Installation Phase</span>
                    <h3 className="font-bold text-base text-white capitalize mt-0.5">
                      {installStatus.state === "failed" ? "❌ Failed" : `⏳ ${installStatus.state.replace(/_/g, " ")}...`}
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-xs text-zinc-400">
                      <span>Official Repository:</span>
                      <a href="https://github.com/coder/mux" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-0.5">
                        github.com/coder/mux
                        <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-white">{installStatus.progress}%</span>
                    {isInstalling && (
                      <Button variant="outline" size="xs" onClick={handleCancelInstall} icon="close" className="text-red-400 border-red-500/20 hover:bg-red-500/5 text-[11px] py-1 px-2.5">
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${installStatus.state === "failed" ? "bg-red-500" : "bg-white"}`}
                    style={{ width: `${installStatus.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Live Terminal Output */}
            <div className="bg-[#04060a] rounded-xl border border-zinc-800 shadow-2xl overflow-hidden flex flex-col" style={{ height: "420px" }}>
              {/* Terminal title bar */}
              <div className="bg-[#0c0e17] px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500/70" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <span className="w-3 h-3 rounded-full bg-green-500/70" />
                  <span className="text-xs font-mono text-zinc-400 ml-2">
                    {isInstalling ? "● npm install -g mux  (running)" : installStatus.state === "failed" ? "✗ install failed" : "✓ install complete"}
                  </span>
                </div>
                <div className="flex gap-2">
                  {installStatus.state === "failed" && (
                    <>
                      <Button variant="outline" size="xs" onClick={handleDeleteMux} icon="delete" className="text-red-400 border-red-500/20 text-[11px] py-1 px-2.5">Clean</Button>
                      <Button variant="primary" size="xs" onClick={handleInstall} icon="refresh" className="bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] py-1 px-2.5">Retry</Button>
                    </>
                  )}
                  {installStatus.state === "completed" && (
                    <Button variant="primary" size="xs" onClick={handleStart} icon="play_arrow" className="bg-white text-black hover:bg-zinc-200 text-[11px] py-1 px-2.5">Start Mux</Button>
                  )}
                </div>
              </div>

              {/* Log lines */}
              <div className="flex-1 p-4 font-mono text-[11px] leading-5 text-zinc-300 overflow-y-auto space-y-0.5 select-text">
                {installStatus.log.length === 0 && (
                  <span className="text-zinc-600">Waiting for output...</span>
                )}
                {installStatus.log.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.startsWith("[ERR]") || line.startsWith("[ERROR]")
                        ? "text-red-400"
                        : line.startsWith(">")
                          ? "text-cyan-400 font-bold"
                          : line.startsWith("✓") || line.includes("successfully")
                            ? "text-green-400"
                            : line.startsWith("●") || line.startsWith("⏳")
                              ? "text-yellow-400"
                              : "text-zinc-300"
                    }
                  >
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        ) : (
          /* Idle state — show feature cards + install button */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card title="Concurrent Agents" subtitle="Scale workflows" icon="diversity_3" className="bg-[#0c0e17] border border-zinc-800">
              <p className="text-xs text-zinc-400 mt-2">
                Offload complex operations to autonomous sub-agents working in parallel, allowing multi-file edits and automated task runs.
              </p>
            </Card>
            <Card title="Integrated Workspace" subtitle="Web-based UI" icon="dock" className="bg-[#0c0e17] border border-zinc-800">
              <p className="text-xs text-zinc-400 mt-2">
                Access a full-featured terminal workspace inside 9Router, letting you visualize planning, execution logs, and output trees.
              </p>
            </Card>
            <Card title="9Router Provider" subtitle="Local LLM Routing" icon="hub" className="bg-[#0c0e17] border border-zinc-800">
              <p className="text-xs text-zinc-400 mt-2">
                Automatically routes Mux requests back through 9Router's LLM endpoints, utilizing custom models, keys, and quotas.
              </p>
            </Card>

            <div className="col-span-1 md:col-span-3 bg-[#0c0e17] border border-zinc-800 rounded-xl p-8 flex flex-col items-center justify-center text-center space-y-4">
              <span className="material-symbols-outlined text-[52px] text-zinc-500 animate-pulse">download_for_offline</span>
              <div>
                <h3 className="font-semibold text-lg text-white">Mux is not installed</h3>
                <p className="text-sm text-zinc-400 mt-1 max-w-md">
                  Installs the official Mux CLI globally via npm. Works on Windows, macOS, and Linux VPS identically.
                </p>
                <p className="text-xs text-zinc-600 mt-1 font-mono">npm install -g mux</p>
              </div>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button variant="primary" icon="download" onClick={handleInstall} className="bg-black hover:bg-zinc-900 text-white border border-zinc-800 font-semibold px-8">
                  Install Mux
                </Button>
                <Button variant="outline" icon="settings" onClick={() => setShowSettings(true)} className="border-zinc-800 hover:bg-zinc-900 text-zinc-300">
                  Configure
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Settings modal */}
        {showSettings && renderSettingsModal()}
      </div>
    );
  }

  // Helper to render Settings Modal
  function renderSettingsModal() {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <Card
          title="Mux Server Configurations"
          subtitle="Configure connection ports and directories for local execution"
          icon="settings"
          action={
            <Button
              variant="outline"
              size="sm"
              icon="close"
              onClick={() => setShowSettings(false)}
              className="border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            />
          }
          className="w-full max-w-lg shadow-2xl bg-[#0c0e17] border border-zinc-800"
        >
          <form onSubmit={handleSaveSettings} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Bind Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full px-3 py-2 bg-black border border-zinc-800 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Bind Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-black border border-zinc-800 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-600"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Mux Source Path</label>
              <input
                type="text"
                value={muxPath}
                onChange={(e) => setMuxPath(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-zinc-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-zinc-600"
                required
              />
            </div>

            <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white">Bypass Authentication</h4>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Allow tokenless HTTP access from localhost</p>
                </div>
                <input
                  type="checkbox"
                  checked={noAuth}
                  onChange={(e) => setNoAuth(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-800 bg-black text-white focus:ring-zinc-600"
                />
              </div>

              {!noAuth && (
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Auth Token</label>
                  <input
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs font-mono text-white focus:outline-none focus:border-zinc-600"
                    placeholder="Enter secret token"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between gap-3 pt-2 border-t border-zinc-800">
              {stats?.installed && (
                <Button
                  variant="outline"
                  type="button"
                  icon="delete"
                  onClick={handleDeleteMux}
                  className="text-red-400 border-red-500/10 hover:bg-red-500/5 text-xs"
                >
                  Delete Mux Fully
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" type="button" onClick={() => setShowSettings(false)} className="border-zinc-800 text-zinc-400 hover:bg-zinc-900">
                  Cancel
                </Button>
                <Button variant="primary" type="submit" className="bg-zinc-800 hover:bg-zinc-700 text-white font-semibold border-zinc-700">
                  Save & Apply
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // 2. Show standard workspace interface if installed
  return (
    <div className={`flex flex-col w-full overflow-hidden relative text-text-main bg-black transition-all duration-300 ${isBarCollapsed ? "h-[calc(100vh-100px)] mt-0" : "h-[calc(100vh-120px)]"}`}>

      {/* ─── Premium Top Control Bar ─── */}
      {!isBarCollapsed && (
        <div className="flex items-center justify-between gap-3 px-5 py-1.5 mb-3 mt-2 rounded-2xl border border-white/[0.06] bg-gradient-to-r from-[#0d0f1a] via-[#111420] to-[#0d0f1a] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_4px_24px_0_rgba(0,0,0,0.5)] backdrop-blur-xl z-10">

          {/* Left: Identity */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon with glow */}
            <div className="relative flex-shrink-0">
              <div className={`absolute inset-0 rounded-xl blur-md transition-all duration-700 ${running ? "bg-violet-500/30" : "bg-zinc-800/20"}`} />
              <div className={`relative w-8 h-8 rounded-xl border flex items-center justify-center transition-all duration-300 ${running ? "bg-white border-white" : "bg-zinc-900 border-zinc-800"}`}>
                <span className={`material-symbols-outlined text-[18px] transition-colors duration-300 ${running ? "text-black" : "text-zinc-400"}`}>smart_toy</span>
              </div>
            </div>

            {/* Name + status */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white tracking-tight whitespace-nowrap">Mux</span>
                <span className="text-[13px] font-light text-zinc-500 tracking-tight hidden sm:block">Agentic Multiplexer</span>
              </div>
              {running && stats?.pid && (
                <p className="text-[10px] text-zinc-600 mt-0 font-mono">pid {stats.pid} · port {config?.port}</p>
              )}
            </div>
          </div>

          {/* Center: Resource meters (only when running) */}
          {running && stats && (
            <div className="hidden md:flex items-center gap-1.5">
              {/* CPU */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="material-symbols-outlined text-[13px] text-violet-400">speed</span>
                <span className="text-[11px] text-zinc-400">CPU</span>
                <span className="text-[11px] font-mono font-bold text-white">{stats.process?.cpu ?? 0}%</span>
              </div>
              {/* RAM */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="material-symbols-outlined text-[13px] text-blue-400">memory</span>
                <span className="text-[11px] text-zinc-400">RAM</span>
                <span className="text-[11px] font-mono font-bold text-white">{formatMB(stats.process?.memory)}</span>
              </div>
              {/* Divider */}
              <div className="h-5 w-px bg-white/[0.06] mx-1" />
              {/* Sys CPU */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="material-symbols-outlined text-[13px] text-zinc-500">developer_board</span>
                <span className="text-[11px] text-zinc-500">Sys</span>
                <span className={`text-[11px] font-mono font-bold ${(stats.system?.cpu ?? 0) > 80 ? "text-red-400" : "text-zinc-300"}`}>{stats.system?.cpu ?? 0}%</span>
              </div>
              {/* Sys RAM */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="material-symbols-outlined text-[13px] text-zinc-500">storage</span>
                <span className="text-[11px] text-zinc-500">Mem</span>
                <span className={`text-[11px] font-mono font-bold ${getSysMemPercent() > 85 ? "text-amber-400" : "text-zinc-300"}`}>{getSysMemPercent()}%</span>
              </div>
            </div>
          )}

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {running ? (
              <>
                {/* Open in new tab */}
                <a
                  href={iframeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.10] hover:border-white/[0.14] transition-all duration-200"
                >
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  Open
                </a>
                {/* Restart */}
                <button
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-zinc-400 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] hover:text-white transition-all duration-200"
                >
                  <span className="material-symbols-outlined text-[14px]">autorenew</span>
                  Restart
                </button>
                {/* Stop */}
                <button
                  onClick={handleStop}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-red-400 bg-red-500/[0.06] border border-red-500/20 hover:bg-red-500/[0.12] hover:border-red-500/30 transition-all duration-200"
                >
                  <span className="material-symbols-outlined text-[14px]">stop_circle</span>
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold text-black bg-white hover:bg-zinc-100 transition-all duration-200 shadow-sm"
              >
                <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                Start Mux
              </button>
            )}

            {/* Collapse button */}
            <button
              onClick={() => setIsBarCollapsed(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] hover:text-zinc-300 transition-all duration-200"
              title="Collapse Control Bar"
            >
              <span className="material-symbols-outlined text-[16px]">visibility_off</span>
            </button>

            {/* Settings gear */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] hover:text-zinc-300 transition-all duration-200"
              title="Settings"
            >
              <span className="material-symbols-outlined text-[16px]">settings</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Restore Button when Collapsed */}
      {isBarCollapsed && (
        <button
          onClick={() => setIsBarCollapsed(false)}
          className="absolute top-3 right-3 z-30 w-8 h-8 rounded-lg flex items-center justify-center bg-black/60 border border-white/10 hover:bg-white/20 text-zinc-400 hover:text-white backdrop-blur-md transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
          title="Show Mux Control Bar"
        >
          <span className="material-symbols-outlined text-[16px]">visibility</span>
        </button>
      )}

      {/* Remote VPS Firewall Warning Banner */}
      {!isBarCollapsed && isRemote && running && showVpsWarning && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-200 text-xs transition-all duration-300">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-red-400 shrink-0">warning</span>
            <span>
              Remote VPS Warning: Mux is currently highly experimental and not optimized for remote networks. Latency and firewall rules on port <strong className="font-mono">{config?.port || 20130}</strong> may affect functionality. Localhost is recommended.
            </span>
          </div>
          <button onClick={() => setShowVpsWarning(false)} className="text-red-400 hover:text-red-200 flex items-center justify-center">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className={`flex-1 w-full h-full relative overflow-hidden bg-[#04060a] shadow-inner transition-all duration-300 ${isBarCollapsed ? "border-0 rounded-none" : "rounded-xl border border-zinc-800"}`}>
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 backdrop-blur-sm z-20">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <h3 className="font-semibold text-lg text-white">Orchestrating Mux Server...</h3>
              <p className="text-sm text-zinc-400 mt-1">Bootstrapping agentic multiplexer services</p>
            </div>
          </div>
        ) : errorMsg ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center z-20">
            <span className="material-symbols-outlined text-red-400 text-[48px]">warning</span>
            <div>
              <h3 className="font-semibold text-lg text-red-400">Initialization Failed</h3>
              <p className="text-sm text-zinc-400 max-w-md mt-1">{errorMsg}</p>
            </div>
            <div className="flex gap-3 mt-2">
              <Button variant="primary" onClick={handleStart} className="bg-zinc-800 hover:bg-zinc-700 text-white">Retry Start</Button>
              <Button variant="outline" onClick={() => setShowSettings(true)} className="border-zinc-800 text-zinc-300">Verify Paths</Button>
            </div>
          </div>
        ) : running ? (
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            className="w-full h-full border-0 bg-transparent"
            allow="clipboard-read; clipboard-write; microphone; camera; midi"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-6 z-20">
            <span className="material-symbols-outlined text-zinc-400 text-[48px]">smart_toy</span>
            <div>
              <h3 className="font-semibold text-lg text-white">Mux Server is Stopped</h3>
              <p className="text-sm text-zinc-400 max-w-md mt-1">
                Start the background server to load the integrated coding multiplexer workspace.
              </p>
            </div>
            <Button variant="primary" icon="play_arrow" onClick={handleStart} className="bg-zinc-800 hover:bg-zinc-700 text-white border-zinc-700 font-semibold">
              Start Server
            </Button>
          </div>
        )}
      </div>

      {/* Settings Sliding Modal */}
      {showSettings && renderSettingsModal()}
    </div>
  );
}

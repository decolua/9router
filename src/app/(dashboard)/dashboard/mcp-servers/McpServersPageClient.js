"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/components/Button";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import { useNotificationStore } from "@/store/notificationStore";
import { SERVER_TYPES, PRESET_SERVERS } from "./presetServers";

export default function McpServersPageClient() {
  const notify = useNotificationStore();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [expandedServer, setExpandedServer] = useState(null);
  const [mounted, setMounted] = useState(false);

  const [activeTab, setActiveTab] = useState("servers");
  const [combos, setCombos] = useState([]);
  const [showComboModal, setShowComboModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [mcpApiKeys, setMcpApiKeys] = useState([]);
  const [showMcpKeyModal, setShowMcpKeyModal] = useState(false);
  const [newMcpKeyName, setNewMcpKeyName] = useState("");
  const [creatingMcpKey, setCreatingMcpKey] = useState(false);
  const [showConfigGenerator, setShowConfigGenerator] = useState(false);
  const [showAdvisory, setShowAdvisory] = useState(true);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem("9router_mcp_advisory_dismissed") === "true";
      if (dismissed) {
        setShowAdvisory(false);
      }
    }
  }, []);

  const dismissAdvisory = () => {
    localStorage.setItem("9router_mcp_advisory_dismissed", "true");
    setShowAdvisory(false);
  };

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-servers");
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCombos = useCallback(async () => {
    try {
      const res = await fetch("/api/combos");
      if (res.ok) {
        const data = await res.json();
        setCombos((data.combos || []).filter((c) => c.kind === "mcp"));
      }
    } catch (error) {
      console.error("Error fetching combos:", error);
    }
  }, []);

  const fetchMcpApiKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-keys");
      if (res.ok) {
        const data = await res.json();
        setMcpApiKeys(data.keys || []);
      }
    } catch (error) {
      console.error("Error fetching MCP API keys:", error);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    fetchCombos();
    fetchMcpApiKeys();
  }, [fetchServers, fetchCombos, fetchMcpApiKeys]);

  const handleTest = async (server) => {
    setTestingId(server.id);
    setTestResults((prev) => ({ ...prev, [server.id]: null }));
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}/test`, {
        method: "POST",
      });
      const result = await res.json();
      setTestResults((prev) => ({ ...prev, [server.id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { ok: false, error: err.message },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (server) => {
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setServers((prev) => prev.filter((s) => s.id !== server.id));
        setDeleteTarget(null);
      }
    } catch {}
  };

  const handleToggleAllServers = async (newActive) => {
    if (servers.length === 0) {
      notify.info("No servers configured. Please add a server first.");
      return;
    }

    await Promise.all(
      servers.map((s) =>
        fetch(`/api/mcp-servers/${s.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );

    setServers((prev) => prev.map((s) => ({ ...s, isActive: newActive })));
    notify.success(
      `${newActive ? "Enabled" : "Disabled"} all ${servers.length} servers`,
    );
  };

  const handleToggleLocalServers = async (newActive) => {
    const localServers = servers.filter((s) => s.type === "local-stdio");
    if (localServers.length === 0) {
      notify.info(
        "No local stdio servers configured. Please add a local server first.",
      );
      return;
    }

    await Promise.all(
      localServers.map((s) =>
        fetch(`/api/mcp-servers/${s.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );

    setServers((prev) =>
      prev.map((s) =>
        s.type === "local-stdio" ? { ...s, isActive: newActive } : s,
      ),
    );
    notify.success(
      `${newActive ? "Enabled" : "Disabled"} all local stdio servers`,
    );
  };

  const handleToggleActive = async (server) => {
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !server.isActive }),
      });
      if (res.ok) {
        setServers((prev) =>
          prev.map((s) =>
            s.id === server.id ? { ...s, isActive: !s.isActive } : s,
          ),
        );
      }
    } catch {}
  };

  const handleAddServer = async (formData) => {
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        const data = await res.json();
        setServers((prev) => [...prev, data.server]);
        setShowAddModal(false);
      }
    } catch {}
  };

  const handleUpdateServer = async (formData) => {
    if (!editingServer) return;
    try {
      const res = await fetch(`/api/mcp-servers/${editingServer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        const data = await res.json();
        setServers((prev) =>
          prev.map((s) => (s.id === editingServer.id ? data.server : s)),
        );
        setEditingServer(null);
      }
    } catch {}
  };

  const handleAddCombo = async (comboData) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comboData, kind: "mcp" }),
      });
      if (res.ok) {
        await fetchCombos();
        setShowComboModal(false);
        notify.success("MCP Combo created successfully");
      } else {
        const err = await res.json();
        notify.error(err.error || "Failed to create MCP combo");
      }
    } catch (err) {
      notify.error("Error creating combo");
    }
  };

  const handleUpdateCombo = async (id, comboData) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comboData, kind: "mcp" }),
      });
      if (res.ok) {
        await fetchCombos();
        setEditingCombo(null);
        notify.success("MCP Combo updated successfully");
      } else {
        const err = await res.json();
        notify.error(err.error || "Failed to update MCP combo");
      }
    } catch (err) {
      notify.error("Error updating combo");
    }
  };

  const handleDeleteCombo = async (id) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos((prev) => prev.filter((c) => c.id !== id));
        notify.success("MCP Combo deleted");
      }
    } catch (err) {
      notify.error("Failed to delete combo");
    }
  };

  const handleToggleComboActive = async (combo) => {
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !combo.isActive }),
      });
      if (res.ok) {
        await fetchCombos();
        notify.success(
          combo.isActive
            ? "MCP Combo disabled"
            : `MCP Combo "${combo.name}" activated`,
        );
      } else {
        notify.error("Failed to toggle combo status");
      }
    } catch {
      notify.error("Error toggling combo status");
    }
  };

  const handleCreateMcpKey = async () => {
    if (!newMcpKeyName.trim()) {
      notify.error("Please enter a name for the API key");
      return;
    }
    setCreatingMcpKey(true);
    try {
      const res = await fetch("/api/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newMcpKeyName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchMcpApiKeys();
        setShowMcpKeyModal(false);
        setNewMcpKeyName("");
        notify.success(`MCP API key created: ${data.key.key}`);
      } else {
        const err = await res.json();
        notify.error(err.error || "Failed to create MCP API key");
      }
    } catch (err) {
      notify.error("Error creating MCP API key");
    } finally {
      setCreatingMcpKey(false);
    }
  };

  const handleToggleMcpKey = async (key) => {
    try {
      const res = await fetch(`/api/mcp-keys/${key.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !key.isActive }),
      });
      if (res.ok) {
        await fetchMcpApiKeys();
        notify.success(
          key.isActive ? "MCP API key disabled" : "MCP API key enabled",
        );
      } else {
        notify.error("Failed to toggle MCP API key");
      }
    } catch {
      notify.error("Error toggling MCP API key");
    }
  };

  const handleDeleteMcpKey = async (key) => {
    if (!confirm(`Delete MCP API key "${key.name}"?`)) return;
    try {
      const res = await fetch(`/api/mcp-keys/${key.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchMcpApiKeys();
        notify.success("MCP API key deleted");
      } else {
        notify.error("Failed to delete MCP API key");
      }
    } catch {
      notify.error("Error deleting MCP API key");
    }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-primary">
              hub
            </span>
            MCP Servers
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Configure MCP servers to add tools and capabilities to your AI
            agents
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === "servers" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon="auto_awesome"
                onClick={() => setShowPresetModal(true)}
              >
                Presets
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon="add"
                onClick={() => setShowAddModal(true)}
              >
                Add Server
              </Button>
            </>
          ) : activeTab === "combos" ? (
            <Button
              variant="primary"
              size="sm"
              icon="add"
              onClick={() => setShowComboModal(true)}
            >
              Create MCP Combo
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon="add"
              onClick={() => setShowMcpKeyModal(true)}
            >
              Create MCP Key
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border-subtle">
        <button
          onClick={() => setActiveTab("servers")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === "servers"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          MCP Servers
        </button>
        <button
          onClick={() => setActiveTab("combos")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === "combos"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          MCP Combos
        </button>
        <button
          onClick={() => setActiveTab("api-keys")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === "api-keys"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          API Keys
        </button>
      </div>

      {/* Servers Tab Content */}
      {activeTab === "servers" && (
        <>
          {/* Warning/Guideline Advisory */}
          {showAdvisory && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-4 flex gap-3 relative">
              <span className="material-symbols-outlined text-amber-500 text-[20px] shrink-0 mt-0.5">
                warning
              </span>
              <div className="flex-1 min-w-0 pr-6">
                <h4 className="text-sm font-semibold text-amber-400">
                  Environment Advisory for MCP Servers
                </h4>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  <strong>Local stdio tools</strong> (command-line/binary
                  processes running on localhost) require running 9Router on a{" "}
                  <strong>local host / development machine</strong> for full
                  functionality. For <strong>VPS or remote deployments</strong>,
                  please configure and use{" "}
                  <strong>remote HTTPS / SSE tools</strong> instead, as local
                  stdio processes are not executable/runnable in typical cloud
                  server virtual environments.
                </p>
              </div>
              <button
                onClick={dismissAdvisory}
                className="absolute top-3 right-3 text-text-muted hover:text-text-main p-1 rounded hover:bg-surface-3 transition-colors cursor-pointer"
                title="Dismiss"
              >
                <span className="material-symbols-outlined text-[16px]">
                  close
                </span>
              </button>
            </div>
          )}

          {/* Grid Container for Gateway Info & Quick Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Gateway Info */}
            <div className="rounded-xl bg-surface-1 border border-border-subtle p-4 flex flex-col justify-between">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center size-9 rounded-lg bg-brand-500/10 shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[18px] text-brand-500">
                    swap_horiz
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text-main">
                    Unified Gateway Endpoint
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    All active servers are accessible through a single gateway.
                    Configure your MCP client to use:
                  </p>
                  <code className="block mt-2 px-3 py-1.5 rounded-lg bg-surface-2 text-xs font-mono text-brand-400 break-all">
                    {mounted
                      ? `${window.location.origin}/api/mcp-gateway`
                      : "/api/mcp-gateway"}
                  </code>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">
                        cell_tower
                      </span>
                      SSE: <code className="text-brand-400">/sse</code>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">
                        send
                      </span>
                      Message: <code className="text-brand-400">/message</code>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">
                        select_all
                      </span>
                      Per-server:{" "}
                      <code className="text-brand-400">/[serverId]/...</code>
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border-subtle flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="settings_input_component"
                  onClick={() => setShowConfigGenerator(true)}
                  className="w-full sm:w-auto"
                >
                  Generate Client Config
                </Button>
              </div>
            </div>

            {/* Quick Controls Card */}
            <div className="rounded-xl bg-surface-1 border border-border-subtle p-4 flex flex-col justify-between">
              <div className="flex items-start gap-3 h-full">
                <div className="flex items-center justify-center size-9 rounded-lg bg-brand-500/10 shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[18px] text-brand-500">
                    tune
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
                  <div>
                    <h3 className="text-sm font-semibold text-text-main">
                      Quick Controls
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      Enable or disable configured MCP servers instantly
                    </p>
                  </div>
                  
                  {/* Control Rows */}
                  <div className="mt-4 flex flex-col gap-3">
                    {/* Row 1: All Servers */}
                    <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-text-main">All Servers</div>
                        <div className="text-[10px] text-text-muted mt-0.5">Manage all configured servers</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="pause_circle"
                          onClick={() => handleToggleAllServers(false)}
                        >
                          Disable All
                        </Button>
                        <Button
                          size="sm"
                          icon="play_circle"
                          onClick={() => handleToggleAllServers(true)}
                        >
                          Enable All
                        </Button>
                      </div>
                    </div>

                    {/* Row 2: Local stdio */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-text-main">Local stdio Servers</div>
                        <div className="text-[10px] text-text-muted mt-0.5">Control local process tools</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="pause_circle"
                          onClick={() => handleToggleLocalServers(false)}
                        >
                          Disable Local
                        </Button>
                        <Button
                          size="sm"
                          icon="play_circle"
                          onClick={() => handleToggleLocalServers(true)}
                        >
                          Enable Local
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Server List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="material-symbols-outlined animate-spin text-2xl text-text-muted">
                progress_activity
              </span>
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-surface-1 border border-border-subtle border-dashed">
              <div className="flex items-center justify-center size-14 rounded-full bg-surface-2 mb-4">
                <span className="material-symbols-outlined text-2xl text-text-muted">
                  hub
                </span>
              </div>
              <h3 className="text-base font-medium text-text-main mb-1">
                No MCP servers configured
              </h3>
              <p className="text-sm text-text-muted mb-4 text-center max-w-md">
                Add MCP servers to give your AI agents access to tools like web
                search, file system, GitHub, and more.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="auto_awesome"
                  onClick={() => setShowPresetModal(true)}
                >
                  Browse Presets
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon="add"
                  onClick={() => setShowAddModal(true)}
                >
                  Add Server
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {[...servers]
                .sort((a, b) => Number(b.isActive) - Number(a.isActive))
                .map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  isExpanded={expandedServer === server.id}
                  onToggleExpand={() =>
                    setExpandedServer(
                      expandedServer === server.id ? null : server.id,
                    )
                  }
                  testingId={testingId}
                  testResult={testResults[server.id]}
                  onTest={handleTest}
                  onToggleActive={handleToggleActive}
                  onEdit={() => setEditingServer(server)}
                  onDelete={() => setDeleteTarget(server)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* API Keys Tab Content */}
      {activeTab === "api-keys" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-main">
                MCP API Keys
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Manage API keys for MCP gateway access. These keys use the mcp_
                prefix and are separate from v1 API keys.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon="add"
              onClick={() => setShowMcpKeyModal(true)}
            >
              Create MCP Key
            </Button>
          </div>

          {mcpApiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-surface-1 border border-border-subtle border-dashed">
              <div className="flex items-center justify-center size-14 rounded-full bg-surface-2 mb-4">
                <span className="material-symbols-outlined text-2xl text-text-muted">
                  key
                </span>
              </div>
              <h3 className="text-base font-medium text-text-main mb-1">
                No MCP API Keys
              </h3>
              <p className="text-sm text-text-muted mb-4 text-center max-w-md">
                Create an MCP API key to authenticate requests to the MCP
                gateway.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon="add"
                onClick={() => setShowMcpKeyModal(true)}
              >
                Create MCP Key
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {mcpApiKeys.map((key) => (
                <div
                  key={key.id}
                  className={`p-4 border rounded-xl flex items-center justify-between gap-4 transition-all duration-200 ${
                    key.isActive
                      ? "bg-surface-1 border-border-subtle hover:border-border"
                      : "bg-surface-1/50 border-border-subtle/50 opacity-60"
                  }`}
                >
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleMcpKey(key)}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${
                      key.isActive ? "bg-brand-500" : "bg-surface-3"
                    }`}
                    title={key.isActive ? "Disable Key" : "Enable Key"}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${
                        key.isActive ? "translate-x-5" : ""
                      }`}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-main">
                        {key.name}
                      </span>
                      {key.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="text-xs px-2 py-1 rounded bg-surface-2 font-mono text-brand-400 break-all">
                        {key.key}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(key.key);
                          notify.success("API key copied to clipboard");
                        }}
                        className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-main transition-colors cursor-pointer"
                        title="Copy to clipboard"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          content_copy
                        </span>
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1">
                      Created: {new Date(key.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDeleteMcpKey(key)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        delete
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Combos Tab Content */}
      {activeTab === "combos" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-main">
                Custom MCP Combos
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Limit and customize which tools are exposed to your editor
                client / IDE. Use `combo=name` parameter.
              </p>
            </div>
          </div>

          {combos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-surface-1 border border-border-subtle border-dashed">
              <div className="flex items-center justify-center size-14 rounded-full bg-surface-2 mb-4">
                <span className="material-symbols-outlined text-2xl text-text-muted">
                  construction
                </span>
              </div>
              <h3 className="text-base font-medium text-text-main mb-1">
                No MCP Combos configured
              </h3>
              <p className="text-sm text-text-muted mb-4 text-center max-w-md">
                Create a combo to restrict specific tools and expose them
                selectively to the IDE client.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon="add"
                onClick={() => setShowComboModal(true)}
              >
                Create MCP Combo
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {combos.map((combo) => (
                <div
                  key={combo.id}
                  className={`p-4 border rounded-xl flex items-center justify-between gap-4 transition-all duration-200 ${
                    combo.isActive
                      ? "bg-surface-1 border-border-subtle hover:border-border"
                      : "bg-surface-1/50 border-border-subtle/50 opacity-60"
                  }`}
                >
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleComboActive(combo)}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${
                      combo.isActive ? "bg-brand-500" : "bg-surface-3"
                    }`}
                    title={combo.isActive ? "Disable Combo" : "Enable Combo"}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${
                        combo.isActive ? "translate-x-5" : ""
                      }`}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold font-mono text-brand-400">
                        {combo.name}
                      </code>
                      {combo.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          Active Exposer
                        </span>
                      )}
                      {combo.maxTools !== null &&
                        combo.maxTools !== undefined && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                            Max Tools: {combo.maxTools}
                          </span>
                        )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {!combo.tools || combo.tools.length === 0 ? (
                        <span className="text-xs text-text-muted italic bg-surface-2 px-2 py-0.5 rounded">
                          All active tools exposed
                        </span>
                      ) : (
                        combo.tools.map((t) => (
                          <code
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 font-mono text-text-muted"
                          >
                            {t}
                          </code>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingCombo(combo)}
                      className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        edit
                      </span>
                    </button>
                    <button
                      onClick={() => handleDeleteCombo(combo.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        delete
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Server Modal */}
      {showAddModal && (
        <ServerFormModal
          title="Add MCP Server"
          onSubmit={handleAddServer}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Preset Modal */}
      {showPresetModal && (
        <PresetModal
          onSelect={(preset) => {
            setShowPresetModal(false);
            handleAddServer(preset);
          }}
          onClose={() => setShowPresetModal(false)}
        />
      )}

      {/* Edit Modal */}
      {editingServer && (
        <ServerFormModal
          title="Edit MCP Server"
          server={editingServer}
          onSubmit={handleUpdateServer}
          onClose={() => setEditingServer(null)}
        />
      )}

      {/* MCP Combo Modals */}
      {showComboModal && (
        <McpComboFormModal
          isOpen={showComboModal}
          onClose={() => setShowComboModal(false)}
          onSave={handleAddCombo}
        />
      )}

      {editingCombo && (
        <McpComboFormModal
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdateCombo(editingCombo.id, data)}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title="Delete MCP Server"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Create MCP API Key Modal */}
      <Modal
        isOpen={showMcpKeyModal}
        onClose={() => {
          setShowMcpKeyModal(false);
          setNewMcpKeyName("");
        }}
        title="Create MCP API Key"
      >
        <div className="flex flex-col gap-4">
          <div>
            <Input
              label="Key Name"
              value={newMcpKeyName}
              onChange={(e) => setNewMcpKeyName(e.target.value)}
              placeholder="e.g., Claude Desktop, Cursor IDE"
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              A descriptive name to identify this API key. Use this key to
              authenticate MCP gateway requests.
            </p>
          </div>

          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
            <p className="text-xs text-blue-400">
              <strong>Note:</strong> MCP API keys use the{" "}
              <code className="font-mono bg-surface-2 px-1 rounded">mcp_</code>{" "}
              prefix and are completely separate from v1 API keys (sk- prefix)
              used for AI model endpoints.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowMcpKeyModal(false);
                setNewMcpKeyName("");
              }}
              disabled={creatingMcpKey}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateMcpKey}
              loading={creatingMcpKey}
              disabled={!newMcpKeyName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Config Generator Modal */}
      <ConfigGeneratorModal
        isOpen={showConfigGenerator}
        onClose={() => setShowConfigGenerator(false)}
        mcpApiKeys={mcpApiKeys}
        activeCombo={combos.find((c) => c.isActive)}
      />
    </div>
  );
}

// ─── Server Card ───────────────────────────────────────────────────────────

function ServerCard({
  server,
  isExpanded,
  onToggleExpand,
  testingId,
  testResult,
  onTest,
  onToggleActive,
  onEdit,
  onDelete,
}) {
  const typeInfo =
    SERVER_TYPES.find((t) => t.id === server.type) || SERVER_TYPES[0];
  const isTesting = testingId === server.id;

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${server.isActive ? "bg-surface-1 border-border-subtle hover:border-border" : "bg-surface-1/50 border-border-subtle/50 opacity-60"}`}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle */}
        <button
          onClick={() => onToggleActive(server)}
          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${server.isActive ? "bg-brand-500" : "bg-surface-3"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${server.isActive ? "translate-x-5" : ""}`}
          />
        </button>

        {/* Icon + Name */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={`flex items-center justify-center size-9 rounded-lg shrink-0 ${server.isActive ? "bg-brand-500/10" : "bg-surface-2"}`}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${server.isActive ? "text-brand-500" : "text-text-muted"}`}
            >
              {typeInfo.icon}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-main truncate">
                {server.name}
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted shrink-0">
                {typeInfo.label}
              </span>
              {testResult && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${testResult.ok ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}
                >
                  {testResult.ok ? "Connected" : "Failed"}
                </span>
              )}
            </div>
            {server.description && (
              <p className="text-xs text-text-muted truncate mt-0.5">
                {server.description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onTest(server)}
            disabled={isTesting}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-brand-500 transition-colors cursor-pointer disabled:opacity-50"
            title="Test connection"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${isTesting ? "animate-spin" : ""}`}
            >
              {isTesting ? "progress_activity" : "play_arrow"}
            </span>
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="Edit"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors cursor-pointer"
            title="Delete"
          >
            <span className="material-symbols-outlined text-[16px]">
              delete
            </span>
          </button>
          <button
            onClick={onToggleExpand}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
          >
            <span
              className="material-symbols-outlined text-[16px] transition-transform"
              style={{ transform: isExpanded ? "rotate(180deg)" : "" }}
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-border-subtle/50">
          <div className="grid gap-2 text-xs">
            {server.url && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-16 shrink-0">URL</span>
                <code className="text-text-main font-mono truncate break-all">
                  {server.url}
                </code>
              </div>
            )}
            {server.command && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-16 shrink-0">Command</span>
                <code className="text-text-main font-mono">
                  {server.command} {(server.args || []).join(" ")}
                </code>
              </div>
            )}
            {server.toolNames?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-text-muted w-16 shrink-0">Tools</span>
                <div className="flex flex-wrap gap-1">
                  {server.toolNames.map((tool) => (
                    <span
                      key={tool}
                      className="px-1.5 py-0.5 rounded bg-surface-2 text-text-muted"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">Endpoint</span>
              <code className="text-brand-400 font-mono">
                /api/mcp-gateway/{server.id}
              </code>
            </div>
          </div>
          {testResult && (
            <div
              className={`mt-2 px-3 py-2 rounded-lg border ${testResult.ok ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}
            >
              {testResult.ok ? (
                <div>
                  <p className="text-xs text-green-500 font-medium mb-1">
                    ✓ Connected — {testResult.toolCount ?? 0} tool
                    {testResult.toolCount !== 1 ? "s" : ""} available
                  </p>
                  {testResult.serverInfo && (
                    <p className="text-[10px] text-text-muted">
                      {testResult.serverInfo.name} v
                      {testResult.serverInfo.version}
                    </p>
                  )}
                  {testResult.tools?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {testResult.tools.map((tool) => (
                        <span
                          key={tool}
                          className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 text-[10px]"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-red-500">{testResult.error}</p>
                  {testResult.hint && (
                    <p className="text-[10px] text-red-400/70 mt-1">
                      {testResult.hint}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Server Form Modal ─────────────────────────────────────────────────────

function ServerFormModal({ title, server, onSubmit, onClose }) {
  const [name, setName] = useState(server?.name || "");
  const [type, setType] = useState(server?.type || "remote-http");
  const [url, setUrl] = useState(server?.url || "");
  const [command, setCommand] = useState(server?.command || "");
  const [argsStr, setArgsStr] = useState((server?.args || []).join(" "));
  const [description, setDescription] = useState(server?.description || "");
  const [headersStr, setHeadersStr] = useState(
    server?.headers ? JSON.stringify(server.headers, null, 2) : "",
  );
  const [toolNamesStr, setToolNamesStr] = useState(
    (server?.toolNames || []).join(", "),
  );
  const [prefix, setPrefix] = useState(server?.prefix || "");
  const [envStr, setEnvStr] = useState(
    server?.env ? JSON.stringify(server.env, null, 2) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isRemote = type === "remote-http" || type === "remote-sse";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const data = { name, type };
      if (isRemote) data.url = url;
      if (type === "local-stdio") {
        data.command = command;
        data.args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
        if (envStr.trim()) {
          try {
            data.env = JSON.parse(envStr);
          } catch {
            setError("Invalid JSON in environment variables");
            setSaving(false);
            return;
          }
        }
      }
      if (description) data.description = description;
      if (headersStr.trim()) {
        try {
          data.headers = JSON.parse(headersStr);
        } catch {
          setError("Invalid JSON in headers");
          setSaving(false);
          return;
        }
      }
      if (toolNamesStr.trim()) {
        data.toolNames = toolNamesStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (prefix.trim()) data.prefix = prefix.trim();
      await onSubmit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface-1 border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text-main">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-muted transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
              required
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Transport Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SERVER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all cursor-pointer ${
                    type === t.id
                      ? "border-brand-500 bg-brand-500/10 text-brand-500"
                      : "border-border bg-surface-2 text-text-muted hover:border-border hover:text-text-main"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {t.icon}
                  </span>
                  <span className="text-[11px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* URL (for remote) */}
          {isRemote && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                Server URL *
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                required
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          )}

          {/* Command (for stdio) */}
          {type === "local-stdio" && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Command *
                </label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Arguments (space-separated)
                </label>
                <input
                  type="text"
                  value={argsStr}
                  onChange={(e) => setArgsStr(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Environment Variables (JSON)
                </label>
                <textarea
                  value={envStr}
                  onChange={(e) => setEnvStr(e.target.value)}
                  placeholder='{"API_KEY": "sk-...", "DEBUG": "true"}'
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors resize-none"
                />
              </div>
            </>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this server provides..."
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Tool Names */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Tool Names (comma-separated)
            </label>
            <input
              type="text"
              value={toolNamesStr}
              onChange={(e) => setToolNamesStr(e.target.value)}
              placeholder="web_search, file_read, execute_command"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Tool Prefix (optional override) */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Tool Prefix (optional)
            </label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="Auto-assigned if left blank (e.g. bro, bro2)"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Namespaces this server&apos;s tools (prefix__tool) so they stay
              unique across servers. Leave blank to auto-assign.
            </p>
          </div>

          {/* Custom Headers (JSON) */}
          {isRemote && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                Custom Headers (JSON)
              </label>
              <textarea
                value={headersStr}
                onChange={(e) => setHeadersStr(e.target.value)}
                placeholder='{"Authorization": "Bearer ..."}'
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-xs text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors resize-none"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={saving}
              icon="save"
            >
              {server ? "Update" : "Add Server"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Preset Modal ──────────────────────────────────────────────────────────

function PresetModal({ onSelect, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-1 border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text-main">
            Add from Preset
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-muted transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 grid gap-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {PRESET_SERVERS.map((preset) => {
            const typeInfo =
              SERVER_TYPES.find((t) => t.id === preset.type) || SERVER_TYPES[0];
            return (
              <button
                key={preset.name}
                onClick={() => onSelect(preset)}
                className="flex items-center w-full min-w-0 gap-3 p-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-transparent hover:border-border-subtle transition-all cursor-pointer text-left"
              >
                <div className="flex items-center justify-center size-9 rounded-lg bg-brand-500/10 shrink-0">
                  <span className="material-symbols-outlined text-[18px] text-brand-500">
                    {typeInfo.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-main">
                      {preset.name}
                    </h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 text-text-muted">
                      {typeInfo.label}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">
                    {preset.description}
                  </p>
                  {preset.setupNote && (
                    <p className="text-[10px] text-amber-400/90 mt-1 whitespace-pre-line">
                      <span className="material-symbols-outlined text-[11px] align-middle mr-0.5">
                        info
                      </span>
                      {preset.setupNote}
                    </p>
                  )}
                </div>
                <span className="material-symbols-outlined text-[16px] text-text-muted">
                  add_circle
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function McpComboFormModal({ isOpen, combo, onClose, onSave }) {
  const [name, setName] = useState(combo?.name || "");
  const [maxTools, setMaxTools] = useState(
    combo?.maxTools !== undefined && combo?.maxTools !== null
      ? combo.maxTools
      : "",
  );
  const [selectedTools, setSelectedTools] = useState(combo?.tools || []);
  const [availableTools, setAvailableTools] = useState([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const fetchTools = async () => {
    setLoadingTools(true);
    try {
      // Internal dashboard endpoint (session-authed). Do NOT call the public
      // gateway /api/mcp-gateway/message route here — that requires an mcp_ key
      // and returns 401 from the browser, leaving the tool list empty.
      const toolsRes = await fetch("/api/mcp-servers/tools");
      if (toolsRes.ok) {
        const toolsData = await toolsRes.json();
        setAvailableTools(toolsData?.tools || []);
      }
    } catch (error) {
      console.error("Error fetching tools:", error);
    } finally {
      setLoadingTools(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchTools();
  }, [isOpen]);

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    const maxVal = maxTools === "" ? null : parseInt(maxTools, 10);
    await onSave({
      name: name.trim(),
      tools: selectedTools,
      maxTools: isNaN(maxVal) ? null : maxVal,
      models: [], // Empty for MCP combos
    });
    setSaving(false);
  };

  const filteredToolsList = availableTools.filter(
    (t) =>
      t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
      (t.description || "").toLowerCase().includes(toolSearch.toLowerCase()),
  );

  const isEdit = !!combo;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit MCP Combo" : "Create MCP Combo"}
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <Input
            label="Combo Name"
            value={name}
            onChange={handleNameChange}
            placeholder="my-mcp-combo"
            error={nameError}
          />
          <p className="text-[10px] text-text-muted mt-0.5">
            Only letters, numbers, -, _ and . allowed. Use this name parameter
            as `combo=name` in query.
          </p>
        </div>

        {/* Max Tools */}
        <div>
          <Input
            label="Max Tools to Expose"
            type="number"
            value={maxTools}
            onChange={(e) => {
              const val = e.target.value;
              setMaxTools(val === "" ? "" : parseInt(val, 10));
            }}
            placeholder="e.g. 10 (Leave blank for no limit)"
            min="0"
          />
          <p className="text-[10px] text-text-muted mt-0.5">
            Limit the maximum number of tools returned to the outer IDE.
          </p>
        </div>

        {/* Tools Selection */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            Exposed MCP Tools
          </label>
          <div className="flex flex-col gap-2">
            <Input
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder="Search active tools..."
            />

            {/* List of all active tools with +/- buttons */}
            <div className="border border-border rounded-lg bg-surface-2 max-h-[200px] overflow-y-auto divide-y divide-border">
              {loadingTools ? (
                <div className="text-center py-6 text-text-muted text-xs">
                  Loading tools from active MCP servers...
                </div>
              ) : availableTools.length === 0 ? (
                <div className="text-center py-6 text-text-muted text-xs">
                  No active MCP tools found. Ensure your MCP servers are
                  connected.
                </div>
              ) : filteredToolsList.length === 0 ? (
                <div className="text-center py-6 text-text-muted text-xs">
                  No tools matching &quot;{toolSearch}&quot;
                </div>
              ) : (
                filteredToolsList.map((tool) => {
                  const isSelected = selectedTools.includes(tool.name);
                  return (
                    <div
                      key={tool.name}
                      className="flex items-center justify-between px-3 py-2 text-xs transition-colors"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <code className="font-semibold block font-mono text-text-main break-all">
                          {tool.name}
                        </code>
                        {tool.description && (
                          <span className="text-[10px] text-text-muted block mt-0.5 line-clamp-2">
                            {tool.description}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedTools(
                              selectedTools.filter((t) => t !== tool.name),
                            );
                          } else {
                            setSelectedTools([...selectedTools, tool.name]);
                          }
                        }}
                        className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                            : "bg-brand-500/10 text-brand-400 hover:bg-brand-500/20"
                        }`}
                        title={
                          isSelected ? "Remove from Combo" : "Add to Combo"
                        }
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {isSelected ? "remove" : "add"}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Tag/Summary of Selected Tools */}
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="text-[10px] text-text-muted font-medium w-full">
                Exposed ({selectedTools.length}):
              </span>
              {selectedTools.length === 0 ? (
                <span className="text-[10px] text-text-muted italic bg-surface-2 px-2 py-0.5 rounded">
                  All active tools exposed by default
                </span>
              ) : (
                selectedTools.map((tName) => (
                  <span
                    key={tName}
                    className="inline-flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 text-brand-400 px-2 py-0.5 rounded text-[10px]"
                  >
                    <code className="font-mono">{tName}</code>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTools(
                          selectedTools.filter((t) => t !== tName),
                        )
                      }
                      className="hover:text-red-500 font-bold ml-1 cursor-pointer"
                    >
                      &times;
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={!name.trim() || !!nameError}
          >
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConfigGeneratorModal({ isOpen, onClose, mcpApiKeys, activeCombo }) {
  const [selectedClient, setSelectedClient] = useState("cursor");
  const [selectedKey, setSelectedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const notify = useNotificationStore();

  const gatewayUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp-gateway`
      : "/api/mcp-gateway";

  const activeKey = selectedKey
    ? mcpApiKeys.find((k) => k.id === selectedKey)
    : mcpApiKeys.find((k) => k.isActive);

  const clients = [
    {
      id: "cursor",
      name: "Cursor",
      icon: "edit_note",
      path: "~/.cursor/mcp.json",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      icon: "code",
      path: "~/.claude.json",
    },
    {
      id: "vscode",
      name: "VS Code",
      icon: "code_blocks",
      path: ".vscode/mcp.json",
    },
    {
      id: "cline",
      name: "Cline",
      icon: "smart_toy",
      path: "~/.cline/mcp.json",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      icon: "surfing",
      path: "~/.codeium/windsurf/mcp_config.json",
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      icon: "auto_awesome",
      path: "~/.gemini/settings.json",
    },
    { id: "generic", name: "Generic MCP", icon: "hub", path: "mcp.json" },
  ];

  const generateConfig = () => {
    const headers = activeKey
      ? { Authorization: `Bearer ${activeKey.key}` }
      : {};

    const comboParam = activeCombo ? `?combo=${activeCombo.name}` : "";
    const fullUrl = `${gatewayUrl}${comboParam}`;

    switch (selectedClient) {
      case "cursor":
        // Cursor: ~/.cursor/mcp.json or .cursor/mcp.json (project-level)
        return `{
  "mcpServers": {
    "9router": {
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)},
      "disabled": false
    }
  }
}`;

      case "claude-code":
        // Claude Code: ~/.claude.json or .mcp.json (project-level)
        return `{
  "mcpServers": {
    "9router": {
      "type": "sse",
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)}
    }
  }
}`;

      case "vscode":
        // VS Code: .vscode/mcp.json (workspace)
        return `{
  "servers": [
    {
      "name": "9router",
      "type": "sse",
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)}
    }
  ]
}`;

      case "cline":
        // Cline: ~/.cline/mcp.json
        return `{
  "mcpServers": {
    "9router": {
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)},
      "disabled": false,
      "autoApprove": []
    }
  }
}`;

      case "windsurf":
        // Windsurf: ~/.codeium/windsurf/mcp_config.json
        return `{
  "mcpServers": {
    "9router": {
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)}
    }
  }
}`;

      case "gemini-cli":
        // Gemini CLI: ~/.gemini/settings.json
        return `{
  "mcpServers": {
    "9router": {
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)}
    }
  }
}`;

      case "generic":
      default:
        return `{
  "mcpServers": {
    "9router": {
      "url": "${fullUrl}",
      "headers": ${JSON.stringify(headers, null, 8)}
    }
  }
}`;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generateConfig());
      setCopied(true);
      notify.success("Config copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      notify.error("Failed to copy config");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="MCP Client Configuration">
      <div className="flex flex-col gap-4">
        {/* Client Selection */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            Select Client
          </label>
          <div className="grid grid-cols-3 gap-2">
            {clients.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedClient(client.id)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                  selectedClient === client.id
                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                    : "border-border bg-surface-2 text-text-muted hover:border-border hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {client.icon}
                </span>
                <span className="text-xs font-medium">{client.name}</span>
                <span className="text-[9px] text-text-muted font-mono truncate w-full text-center">
                  {client.path}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* API Key Selection */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            API Key (Optional)
          </label>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">No authentication</option>
            {mcpApiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} ({key.key.substring(0, 8)}...)
              </option>
            ))}
          </select>
          <p className="text-[10px] text-text-muted mt-1">
            {activeKey
              ? "✓ Using API key for authentication"
              : "No API key selected - gateway will be publicly accessible"}
          </p>
        </div>

        {/* Active Combo Info */}
        {activeCombo && (
          <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-3">
            <p className="text-xs text-brand-400">
              <strong>Active Combo:</strong> {activeCombo.name}
              <br />
              <span className="text-[10px] text-text-muted mt-1 block">
                Only tools in this combo will be exposed through the gateway.
              </span>
            </p>
          </div>
        )}

        {/* Generated Config */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-text-muted">
              Generated Configuration
            </label>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? "check" : "content_copy"}
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <pre className="p-3 rounded-lg bg-surface-2 border border-border overflow-x-auto text-xs font-mono text-text-main max-h-64 overflow-y-auto">
            {generateConfig()}
          </pre>
        </div>

        {/* Instructions */}
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
          <p className="text-xs text-blue-400">
            <strong>
              How to use ({clients.find((c) => c.id === selectedClient)?.name}):
            </strong>
            <br />
            1. Copy the configuration above
            <br />
            2.{" "}
            {selectedClient === "cursor" &&
              "Paste into ~/.cursor/mcp.json (global) or .cursor/mcp.json (project)"}
            {selectedClient === "claude-code" &&
              "Paste into ~/.claude.json (user) or .mcp.json (project)"}
            {selectedClient === "vscode" &&
              "Paste into .vscode/mcp.json (workspace) or use VS Code settings"}
            {selectedClient === "cline" && "Paste into ~/.cline/mcp.json"}
            {selectedClient === "windsurf" &&
              "Paste into ~/.codeium/windsurf/mcp_config.json"}
            {selectedClient === "gemini-cli" &&
              "Paste into ~/.gemini/settings.json"}
            {selectedClient === "generic" &&
              "Paste into your MCP client's configuration file"}
            <br />
            3. Restart your client to connect to the gateway
            <br />
            4. All active MCP servers will be available as tools
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

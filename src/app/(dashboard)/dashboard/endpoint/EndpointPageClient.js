"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/* ========== CLOUD CODE — COMMENTED OUT (replaced by Tunnel) ==========
const DEFAULT_CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL || "";
const CLOUD_ACTION_TIMEOUT_MS = 15000;
========== END CLOUD CODE ========== */

const TUNNEL_BENEFITS = [
  { icon: "public", title: "Access Anywhere", desc: "Use your API from any network" },
  { icon: "group", title: "Share Endpoint", desc: "Share URL with team members" },
  { icon: "code", title: "Use in Cursor/Cline", desc: "Connect AI tools remotely" },
  { icon: "lock", title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

const TUNNEL_ACTION_TIMEOUT_MS = 90000;

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);

  /* ========== CLOUD STATE — COMMENTED OUT (replaced by Tunnel) ==========
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudUrl, setCloudUrl] = useState(DEFAULT_CLOUD_URL);
  const [cloudUrlInput, setCloudUrlInput] = useState(DEFAULT_CLOUD_URL);
  const [cloudUrlSaving, setCloudUrlSaving] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupStatus, setSetupStatus] = useState(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [syncStep, setSyncStep] = useState("");
  ========== END CLOUD STATE ========== */

  // Tunnel state
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelShortId, setTunnelShortId] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showEnableModal, setShowEnableModal] = useState(false);
  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  /* ========== CLOUD FUNCTIONS — COMMENTED OUT (replaced by Tunnel) ==========
  const postCloudAction = async (action, timeoutMs = CLOUD_ACTION_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/sync/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { ok: false, status: 408, data: { error: "Cloud request timeout" } };
      }
      return { ok: false, status: 500, data: { error: error.message || "Cloud request failed" } };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const loadCloudSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setCloudEnabled(data.cloudEnabled || false);
        setRequireApiKey(data.requireApiKey || false);
        const url = data.cloudUrl || DEFAULT_CLOUD_URL;
        setCloudUrl(url);
        setCloudUrlInput(url);
      }
    } catch (error) {
      console.log("Error loading cloud settings:", error);
    }
  };

  const handleCloudToggle = (checked) => {
    if (checked) {
      setShowCloudModal(true);
    } else {
      setShowDisableModal(true);
    }
  };

  const handleEnableCloud = async () => {
    setCloudSyncing(true);
    setSyncStep("syncing");
    try {
      const { ok, data } = await postCloudAction("enable");
      if (ok) {
        setSyncStep("verifying");
        if (data.verified) {
          setCloudEnabled(true);
          setCloudStatus({ type: "success", message: "Cloud Proxy connected and verified!" });
          setShowCloudModal(false);
        } else {
          setCloudEnabled(true);
          setCloudStatus({ type: "warning", message: data.verifyError || "Connected but verification failed" });
          setShowCloudModal(false);
        }
        if (data.createdKey) await fetchData();
      } else {
        setCloudStatus({ type: "error", message: data.error || "Failed to enable cloud" });
      }
    } catch (error) {
      setCloudStatus({ type: "error", message: error.message });
    } finally {
      setCloudSyncing(false);
      setSyncStep("");
    }
  };

  const handleConfirmDisable = async () => {
    setCloudSyncing(true);
    setSyncStep("syncing");
    try {
      await postCloudAction("sync");
      setSyncStep("disabling");
      const { ok, data } = await postCloudAction("disable");
      if (ok) {
        setCloudEnabled(false);
        setCloudStatus({ type: "success", message: "Cloud disabled" });
        setShowDisableModal(false);
      } else {
        setCloudStatus({ type: "error", message: data.error || "Failed to disable cloud" });
      }
    } catch (error) {
      setCloudStatus({ type: "error", message: "Failed to disable cloud" });
    } finally {
      setCloudSyncing(false);
      setSyncStep("");
    }
  };

  const handleSyncCloud = async () => {
    if (!cloudEnabled) return;
    setCloudSyncing(true);
    try {
      const { ok, data } = await postCloudAction("sync");
      if (ok) setCloudStatus({ type: "success", message: "Synced successfully" });
      else setCloudStatus({ type: "error", message: data.error });
    } catch (error) {
      setCloudStatus({ type: "error", message: error.message });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleSaveCloudUrl = async () => {
    const trimmed = cloudUrlInput.trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    if (!trimmed) return;
    setCloudUrlSaving(true);
    setSetupStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloudUrl: trimmed }),
      });
      if (res.ok) {
        setCloudUrl(trimmed);
        setCloudUrlInput(trimmed);
        setSetupStatus({ type: "success", message: "Worker URL saved" });
      } else {
        setSetupStatus({ type: "error", message: "Failed to save Worker URL" });
      }
    } catch (error) {
      setSetupStatus({ type: "error", message: error.message });
    } finally {
      setCloudUrlSaving(false);
    }
  };

  const handleCheckCloud = async () => {
    if (!cloudUrl) return;
    setCloudSyncing(true);
    setSetupStatus(null);
    try {
      const { ok, data } = await postCloudAction("check", 8000);
      if (ok) setSetupStatus({ type: "success", message: data.message || "Worker is running" });
      else setSetupStatus({ type: "error", message: data.error || "Check failed" });
    } catch {
      setSetupStatus({ type: "error", message: "Cannot reach worker" });
    } finally {
      setCloudSyncing(false);
    }
  };
  ========== END CLOUD FUNCTIONS ========== */

  const loadSettings = async () => {
    try {
      const [settingsRes, tunnelRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status")
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
      }
      if (tunnelRes.ok) {
        const data = await tunnelRes.json();
        setTunnelEnabled(data.enabled || false);
        setTunnelUrl(data.tunnelUrl || "");
        setTunnelShortId(data.shortId || "");
      }
    } catch (error) {
      console.log("Error loading settings:", error);
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
      const keysRes = await fetch("/api/keys");
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setKeys(keysData.keys || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleEnableTunnel = async () => {
    setShowEnableModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Connecting to server...");

    const progressSteps = [
      { delay: 2000, msg: "Creating tunnel..." },
      { delay: 5000, msg: "Starting cloudflared..." },
      { delay: 15000, msg: "Establishing connections..." },
      { delay: 30000, msg: "Waiting for tunnel ready..." },
    ];
    const timers = progressSteps.map(({ delay, msg }) =>
      setTimeout(() => setTunnelProgress(msg), delay)
    );

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TUNNEL_ACTION_TIMEOUT_MS);
      const res = await fetch("/api/tunnel/enable", {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      timers.forEach(clearTimeout);
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(true);
        setTunnelUrl(data.tunnelUrl || "");
        setTunnelShortId(data.shortId || "");
        setTunnelStatus({ type: "success", message: "Tunnel connected!" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
      }
    } catch (error) {
      timers.forEach(clearTimeout);
      const msg = error?.name === "AbortError" ? "Tunnel creation timed out" : error.message;
      setTunnelStatus({ type: "error", message: msg });
    } finally {
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
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
        setShowDisableModal(false);
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm("Delete this API key?")) return;

    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(keys.filter((k) => k.id !== id));
        // Clean up visibility state
        setVisibleKeys(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      console.log("Error deleting key:", error);
    }
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
    if (!fullKey) return "";
    return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
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

  const currentEndpoint = tunnelEnabled && tunnelUrl ? `${tunnelUrl}/v1` : baseUrl;

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">API Endpoint</h2>
            <p className="text-sm text-text-muted">
              {tunnelEnabled ? "Using Tunnel" : "Using Local Server"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tunnelEnabled ? (
              <Button
                size="sm"
                variant="secondary"
                icon="cloud_off"
                onClick={() => setShowDisableModal(true)}
                disabled={tunnelLoading}
                className="bg-red-500/10! text-red-500! hover:bg-red-500/20! border-red-500/30!"
              >
                Disable Tunnel
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="cloud_upload"
                onClick={() => setShowEnableModal(true)}
                disabled={tunnelLoading}
                className="bg-linear-to-r from-primary to-blue-500 hover:from-primary-hover hover:to-blue-600"
              >
                {tunnelLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                    {tunnelProgress || "Creating tunnel..."}
                  </span>
                ) : "Enable Tunnel"}
              </Button>
            )}
          </div>
        </div>

        {/* Endpoint URL */}
        <div className="flex gap-2">
          <Input 
            value={currentEndpoint} 
            readOnly 
            className={`flex-1 font-mono text-sm ${tunnelEnabled ? "animate-border-glow" : ""}`}
          />
          <Button
            variant="secondary"
            icon={copied === "endpoint_url" ? "check" : "content_copy"}
            onClick={() => copy(currentEndpoint, "endpoint_url")}
          >
            {copied === "endpoint_url" ? "Copied!" : "Copy"}
          </Button>
        </div>

        {/* Tunnel Status */}
        {tunnelStatus && (
          <div className={`mt-3 p-2 rounded text-sm ${
            tunnelStatus.type === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" :
            tunnelStatus.type === "warning" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" :
            "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}>
            {tunnelStatus.message}
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">API Keys</h2>
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
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                      title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                    <button
                      onClick={() => copy(key.key, key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === key.id ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  {key.isActive === false && (
                    <p className="text-xs text-orange-500 mt-1">Paused</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    size="sm"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        if (confirm(`Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`)) {
                          handleToggleKey(key.id, checked);
                        }
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? "Pause key" : "Resume key"}
                  />
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* CLOUD MODALS — COMMENTED OUT (replaced by Tunnel) */}
      {/* Setup Cloud Modal — removed */}
      {/* Cloud Enable Modal — removed */}

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
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
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
        isOpen={showEnableModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">cloud_upload</span>
              <div>
                <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
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
            <Button
              onClick={handleEnableTunnel}
              fullWidth
              className="bg-linear-to-r from-primary to-blue-500 hover:from-primary-hover hover:to-blue-600 text-white!"
            >
              Start Tunnel
            </Button>
            <Button
              onClick={() => setShowEnableModal(false)}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Disable Tunnel Modal */}
      <Modal
        isOpen={showDisableModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-red-600 dark:text-red-400">warning</span>
              <div>
                <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-1">
                  Warning
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  The tunnel will be disconnected. Remote access will stop working.
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-text-muted">Are you sure you want to disable the tunnel?</p>

          <div className="flex gap-2">
            <Button
              onClick={handleDisableTunnel}
              fullWidth
              disabled={tunnelLoading}
              className="bg-red-500! hover:bg-red-600! text-white!"
            >
              {tunnelLoading ? (
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  Disabling...
                </span>
              ) : "Disable Tunnel"}
            </Button>
            <Button
              onClick={() => setShowDisableModal(false)}
              variant="ghost"
              fullWidth
              disabled={tunnelLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};

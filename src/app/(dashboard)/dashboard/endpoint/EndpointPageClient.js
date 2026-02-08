"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;
const CLOUD_ACTION_TIMEOUT_MS = 15000;

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);

  // Cloud sync state
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [syncStep, setSyncStep] = useState(""); // "syncing" | "verifying" | "disabling" | ""

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
    loadCloudSettings();
  }, []);

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
      }
    } catch (error) {
      console.log("Error loading cloud settings:", error);
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
          setCloudStatus({ 
            type: "warning", 
            message: data.verifyError || "Connected but verification failed" 
          });
          setShowCloudModal(false);
        }
        
        // Refresh keys list if new key was created
        if (data.createdKey) {
          await fetchData();
        }
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
      // Step 1: Sync latest data from cloud
      await postCloudAction("sync");

      setSyncStep("disabling");

      // Step 2: Disable cloud
      const { ok, data } = await postCloudAction("disable");

      if (ok) {
        setCloudEnabled(false);
        setCloudStatus({ type: "success", message: "Cloud disabled" });
        setShowDisableModal(false);
      } else {
        setCloudStatus({ type: "error", message: data.error || "Failed to disable cloud" });
      }
    } catch (error) {
      console.log("Error disabling cloud:", error);
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
      if (ok) {
        setCloudStatus({ type: "success", message: "Synced successfully" });
      } else {
        setCloudStatus({ type: "error", message: data.error });
      }
    } catch (error) {
      setCloudStatus({ type: "error", message: error.message });
    } finally {
      setCloudSyncing(false);
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
      }
    } catch (error) {
      console.log("Error deleting key:", error);
    }
  };

  const [baseUrl, setBaseUrl] = useState("/v1");
  const cloudEndpointNew = `${CLOUD_URL}/v1`;

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

  // Use new format endpoint (machineId embedded in key)
  const currentEndpoint = cloudEnabled ? cloudEndpointNew : baseUrl;

  const cloudBenefits = [
    { icon: "public", title: "Access Anywhere", desc: "No port forwarding needed" },
    { icon: "group", title: "Share Endpoint", desc: "Easy team collaboration" },
    { icon: "schedule", title: "Always Online", desc: "24/7 availability" },
    { icon: "speed", title: "Global Edge", desc: "Fast worldwide access" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card className={cloudEnabled ? "" : ""}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">API Endpoint</h2>
            <p className="text-sm text-text-muted">
              {cloudEnabled ? "Using Cloud Proxy" : "Using Local Server"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cloudEnabled ? (
              <Button
                size="sm"
                variant="secondary"
                icon="cloud_off"
                onClick={() => handleCloudToggle(false)}
                disabled={cloudSyncing}
                className="bg-red-500/10! text-red-500! hover:bg-red-500/20! border-red-500/30!"
              >
                Disable Cloud
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="cloud_upload"
                onClick={() => handleCloudToggle(true)}
                disabled={cloudSyncing}
                className="bg-linear-to-r from-primary to-blue-500 hover:from-primary-hover hover:to-blue-600"
              >
                Enable Cloud
              </Button>
            )}
          </div>
        </div>

        {/* Endpoint URL */}
        <div className="flex gap-2 mb-3">
          <Input 
            value={currentEndpoint} 
            readOnly 
            className={`flex-1 font-mono text-sm ${cloudEnabled ? "animate-border-glow" : ""}`}
          />
          <Button
            variant="secondary"
            icon={copied === "endpoint_url" ? "check" : "content_copy"}
            onClick={() => copy(currentEndpoint, "endpoint_url")}
          >
            {copied === "endpoint_url" ? "Copied!" : "Copy"}
          </Button>
        </div>

      </Card>

      {/* API Keys */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
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
                className="group flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-text-muted font-mono">{key.key}</code>
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
                </div>
                <button
                  onClick={() => handleDeleteKey(key.id)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Cloud Proxy Card - Hidden */}
      {false && (
        <Card className={cloudEnabled ? "bg-primary/5" : ""}>
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${cloudEnabled ? "bg-primary text-white" : "bg-sidebar text-text-muted"}`}>
                  <span className="material-symbols-outlined text-xl">cloud</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Cloud Proxy</h2>
                  <p className="text-xs text-text-muted">
                    {cloudEnabled ? "Connected & Ready" : "Access your API from anywhere"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cloudEnabled ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="cloud_off"
                    onClick={() => handleCloudToggle(false)}
                    disabled={cloudSyncing}
                    className="bg-red-500/10! text-red-500! hover:bg-red-500/20! border-red-500/30!"
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon="cloud_upload"
                    onClick={() => handleCloudToggle(true)}
                    disabled={cloudSyncing}
                    className="bg-linear-to-r from-primary to-blue-500 hover:from-primary-hover hover:to-blue-600 px-6"
                  >
                    Enable Cloud
                  </Button>
                )}
              </div>
            </div>

            {/* Benefits Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {cloudBenefits.map((benefit) => (
                <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                  <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                  <p className="text-xs font-semibold">{benefit.title}</p>
                  <p className="text-xs text-text-muted">{benefit.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Cloud Enable Modal */}
      <Modal
        isOpen={showCloudModal}
        title="Enable Cloud Proxy"
        onClose={() => setShowCloudModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
              What you will get
            </p>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• Access your API from anywhere in the world</li>
              <li>• Share endpoint with your team easily</li>
              <li>• No need to open ports or configure firewall</li>
              <li>• Fast global edge network</li>
            </ul>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-1">
              Note
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
              <li>• Cloud will keep your auth session for 1 day. If not used, it will be automatically deleted.</li>
              <li>• Cloud is currently unstable with Claude Code OAuth in some cases.</li>
            </ul>
          </div>

          {/* Sync Progress */}
          {cloudSyncing && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
              <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-primary">
                  {syncStep === "syncing" && "Syncing data to cloud..."}
                  {syncStep === "verifying" && "Verifying connection..."}
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleEnableCloud}
              fullWidth
              disabled={cloudSyncing}
            >
              {cloudSyncing ? (
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {syncStep === "syncing" ? "Syncing..." : "Verifying..."}
                </span>
              ) : "Enable Cloud"}
            </Button>
            <Button
              onClick={() => setShowCloudModal(false)}
              variant="ghost"
              fullWidth
              disabled={cloudSyncing}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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

      {/* Disable Cloud Modal */}
      <Modal
        isOpen={showDisableModal}
        title="Disable Cloud Proxy"
        onClose={() => !cloudSyncing && setShowDisableModal(false)}
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
                  All auth sessions will be deleted from cloud.
                </p>
              </div>
            </div>
          </div>

          {/* Sync Progress */}
          {cloudSyncing && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
              <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-primary">
                  {syncStep === "syncing" && "Syncing latest data..."}
                  {syncStep === "disabling" && "Disabling cloud..."}
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-text-muted">Are you sure you want to disable cloud proxy?</p>

          <div className="flex gap-2">
            <Button
              onClick={handleConfirmDisable}
              fullWidth
              disabled={cloudSyncing}
              className="bg-red-500! hover:bg-red-600! text-white!"
            >
              {cloudSyncing ? (
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {syncStep === "syncing" ? "Syncing..." : "Disabling..."}
                </span>
              ) : "Disable Cloud"}
            </Button>
            <Button
              onClick={() => setShowDisableModal(false)}
              variant="ghost"
              fullWidth
              disabled={cloudSyncing}
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

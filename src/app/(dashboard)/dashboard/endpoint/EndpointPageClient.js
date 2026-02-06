"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, ConfirmModal, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState(null);
  const [rotatingKeyId, setRotatingKeyId] = useState(null);
  const [historyKey, setHistoryKey] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [rotateGraceHours, setRotateGraceHours] = useState(2);
  const [rotateLoading, setRotateLoading] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState(null);
  const [revokeLoadingId, setRevokeLoadingId] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [newOwnerAge, setNewOwnerAge] = useState("");
  const [newRequestLimit, setNewRequestLimit] = useState("");
  const [newTokenLimit, setNewTokenLimit] = useState("");
  const [newAllowedModels, setNewAllowedModels] = useState([]);
  const [newModelSearch, setNewModelSearch] = useState("");
  const [newModelProvider, setNewModelProvider] = useState("all");
  const [editKeyName, setEditKeyName] = useState("");
  const [editOwnerName, setEditOwnerName] = useState("");
  const [editOwnerEmail, setEditOwnerEmail] = useState("");
  const [editOwnerAge, setEditOwnerAge] = useState("");
  const [editRequestLimit, setEditRequestLimit] = useState("");
  const [editTokenLimit, setEditTokenLimit] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState([]);
  const [editModelSearch, setEditModelSearch] = useState("");
  const [editModelProvider, setEditModelProvider] = useState("all");
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

  const openCreateModal = () => {
    setShowAddModal(true);
    // Empty list means "allow all models".
    setNewAllowedModels([]);
  };

  const closeCreateModal = () => {
    setShowAddModal(false);
    setNewKeyName("");
    setNewOwnerName("");
    setNewOwnerEmail("");
    setNewOwnerAge("");
    setNewRequestLimit("");
    setNewTokenLimit("");
    setNewAllowedModels([]);
    setNewModelSearch("");
    setNewModelProvider("all");
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingKeyId(null);
    setEditKeyName("");
    setEditOwnerName("");
    setEditOwnerEmail("");
    setEditOwnerAge("");
    setEditRequestLimit("");
    setEditTokenLimit("");
    setEditAllowedModels([]);
    setEditModelSearch("");
    setEditModelProvider("all");
  };

  const closeRotateModal = () => {
    setShowRotateModal(false);
    setRotatingKeyId(null);
    setRotateGraceHours(2);
  };

  const closeHistoryModal = () => {
    setShowHistoryModal(false);
    setHistoryKey(null);
  };

  const closeRevokeModal = () => {
    setShowRevokeModal(false);
    setRevokeTarget(null);
  };

  const normalizeModelList = (data) => {
    if (Array.isArray(data?.data)) {
      return [...new Set(data.data.map((m) => m?.id).filter(Boolean))].sort();
    }
    if (Array.isArray(data?.models)) {
      return [...new Set(
        data.models
          .map((m) => m?.fullModel || (m?.provider && m?.model ? `${m.provider}/${m.model}` : m?.name))
          .filter(Boolean),
      )].sort();
    }
    return [];
  };

  const fetchAvailableModels = async (preferredKey = null) => {
    setModelsLoading(true);
    try {
      let modelList = [];

      if (preferredKey) {
        const res = await fetch("/api/v1/models", {
          headers: {
            Authorization: `Bearer ${preferredKey}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          modelList = normalizeModelList(data);
        }
      }

      if (modelList.length === 0) {
        const fallbackRes = await fetch("/api/models");
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          modelList = normalizeModelList(fallbackData);
        }
      }

      setAvailableModels(modelList);
    } catch (error) {
      console.log("Error fetching available models:", error);
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
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
        const loadedKeys = keysData.keys || [];
        setKeys(loadedKeys);
        await fetchAvailableModels(loadedKeys[0]?.key || null);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
      setKeys([]);
      await fetchAvailableModels(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleAllowedModel = (modelId, list, setter) => {
    if (list.includes(modelId)) {
      setter(list.filter((m) => m !== modelId));
    } else {
      setter([...list, modelId]);
    }
  };

  const openEditModal = (key) => {
    setEditingKeyId(key.id);
    setEditKeyName(key.name || "");
    setEditOwnerName(key.ownerName || "");
    setEditOwnerEmail(key.ownerEmail || "");
    setEditOwnerAge(key.ownerAge === null || key.ownerAge === undefined ? "" : String(key.ownerAge));
    setEditRequestLimit(key.requestLimit ? String(key.requestLimit) : "");
    setEditTokenLimit(key.tokenLimit ? String(key.tokenLimit) : "");

    const keyAllowed = Array.isArray(key.allowedModels) ? key.allowedModels : [];
    // Persist semantics: empty list means "allow all models".
    setEditAllowedModels(keyAllowed);
    setShowEditModal(true);
  };

  const openRotateModal = (key) => {
    setRotatingKeyId(key.id);
    setRotateGraceHours(2);
    setShowRotateModal(true);
  };

  const openHistoryModal = (key) => {
    if (!key) return;
    const previousKeys = Array.isArray(key.previousKeys)
      ? key.previousKeys.filter((entry) => entry && entry.expiresAt)
      : [];
    setHistoryKey({
      ...key,
      previousKeys,
    });
    setShowHistoryModal(true);
  };

  const openRevokeModal = (keyId, keyHash) => {
    if (!keyId || !keyHash) return;
    setRevokeTarget({ keyId, keyHash });
    setShowRevokeModal(true);
  };

  const handleRotateKey = async () => {
    if (!rotatingKeyId) return;
    setRotateLoading(true);
    try {
      const res = await fetch(`/api/keys/${rotatingKeyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate", graceHours: rotateGraceHours }),
      });

      const data = await res.json();
      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        closeRotateModal();
      }
    } catch (error) {
      console.log("Error rotating key:", error);
    } finally {
      setRotateLoading(false);
    }
  };

  const formatRotateExpiry = () => {
    if (rotateGraceHours === 0) return "immediately";
    const expiresAt = new Date(Date.now() + rotateGraceHours * 60 * 60 * 1000);
    return expiresAt.toLocaleString();
  };

  const handleUpdateKey = async () => {
    if (!editingKeyId || !editKeyName.trim()) return;

    try {
      const res = await fetch(`/api/keys/${editingKeyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editKeyName,
          ownerName: editOwnerName,
          ownerEmail: editOwnerEmail,
          ownerAge: editOwnerAge === "" ? null : Number(editOwnerAge),
          requestLimit: editRequestLimit === "" ? 0 : Number(editRequestLimit),
          tokenLimit: editTokenLimit === "" ? 0 : Number(editTokenLimit),
          allowedModels: editAllowedModels,
        }),
      });

      if (res.ok) {
        await fetchData();
        closeEditModal();
      }
    } catch (error) {
      console.log("Error updating key:", error);
    }
  };

  const handleToggleKeyStatus = async (keyId, nextActive) => {
    setToggleLoadingId(keyId);
    try {
      const res = await fetch(`/api/keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (error) {
      console.log("Error updating key status:", error);
    } finally {
      setToggleLoadingId(null);
    }
  };

  const handleRevokePreviousKey = async (keyId, previousKeyHash) => {
    if (!keyId || !previousKeyHash) return;
    setRevokeLoadingId(`${keyId}:${previousKeyHash}`);
    try {
      const res = await fetch(`/api/keys/${keyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revokePreviousKey", keyHash: previousKeyHash }),
      });
      if (res.ok) {
        await fetchData();
        setHistoryKey((prev) => {
          if (!prev || prev.id !== keyId) return prev;
          return {
            ...prev,
            previousKeys: Array.isArray(prev.previousKeys)
              ? prev.previousKeys.filter((entry) => entry.keyHash !== previousKeyHash)
              : [],
          };
        });
        closeRevokeModal();
      }
    } catch (error) {
      console.log("Error revoking previous key:", error);
    } finally {
      setRevokeLoadingId(null);
    }
  };

  const getProviderOptions = () => {
    const providers = new Set();
    availableModels.forEach((modelId) => {
      if (typeof modelId !== "string") return;
      const parts = modelId.split("/");
      if (parts.length > 1 && parts[0]) providers.add(parts[0]);
    });
    return ["all", ...Array.from(providers).sort()];
  };

  const filterModels = (searchValue, providerValue) => {
    const search = String(searchValue || "").trim().toLowerCase();
    const provider = providerValue || "all";
    return availableModels.filter((modelId) => {
      if (provider !== "all" && !String(modelId).startsWith(`${provider}/`)) return false;
      if (!search) return true;
      return String(modelId).toLowerCase().includes(search);
    });
  };

  const providerOptions = getProviderOptions();
  const filteredNewModels = filterModels(newModelSearch, newModelProvider);
  const filteredEditModels = filterModels(editModelSearch, editModelProvider);

  const maskKeyValue = (value) => {
    if (!value) return "";
    const str = String(value);
    if (str.length <= 12) return "••••";
    return `${str.slice(0, 6)}••••${str.slice(-4)}`;
  };

  const formatHistoryTime = (iso) => {
    if (!iso) return "-";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
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
      const res = await fetch("/api/sync/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" })
      });

      const data = await res.json();
      if (res.ok) {
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
      await fetch("/api/sync/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" })
      });

      setSyncStep("disabling");

      // Step 2: Disable cloud
      const disableRes = await fetch("/api/sync/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable" })
      });

      if (disableRes.ok) {
        setCloudEnabled(false);
        setCloudStatus({ type: "success", message: "Cloud disabled" });
        setShowDisableModal(false);
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
      const res = await fetch("/api/sync/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" })
      });

      const data = await res.json();
      if (res.ok) {
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
        body: JSON.stringify({
          name: newKeyName,
          ownerName: newOwnerName,
          ownerEmail: newOwnerEmail,
          ownerAge: newOwnerAge === "" ? null : Number(newOwnerAge),
          requestLimit: newRequestLimit === "" ? 0 : Number(newRequestLimit),
          tokenLimit: newTokenLimit === "" ? 0 : Number(newTokenLimit),
          allowedModels: newAllowedModels,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setNewOwnerName("");
        setNewOwnerEmail("");
        setNewOwnerAge("");
        setNewRequestLimit("");
        setNewTokenLimit("");
        setNewAllowedModels([]);
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
          <Button icon="add" onClick={openCreateModal}>
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
            <Button icon="add" onClick={openCreateModal}>
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
                    <span
                      className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                        key.isActive === false
                          ? "border-red-300/80 text-red-600 bg-red-50"
                          : "border-emerald-200 text-emerald-700 bg-emerald-50"
                      }`}
                    >
                      {key.isActive === false ? "Disabled" : "Active"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleKeyStatus(key.id, key.isActive === false)}
                      disabled={toggleLoadingId === key.id}
                      title={key.isActive === false ? "Enable key" : "Disable key"}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                        key.isActive === false
                          ? "bg-bg-subtle border border-border"
                          : "bg-primary"
                      } ${toggleLoadingId === key.id ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          key.isActive === false ? "translate-x-1" : "translate-x-5"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openHistoryModal(key)}
                      className="text-xs text-text-muted hover:text-primary"
                    >
                      History
                    </button>
                  </div>
                  {(key.ownerName || key.ownerEmail || (key.ownerAge !== null && key.ownerAge !== undefined)) && (
                    <p className="text-xs text-text-muted mt-0.5">
                      Owner: {key.ownerName || "-"}
                      {key.ownerEmail ? ` • ${key.ownerEmail}` : ""}
                      {key.ownerAge !== null && key.ownerAge !== undefined ? ` • ${key.ownerAge}y` : ""}
                    </p>
                  )}
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
                  <p className="text-xs text-text-muted mt-0.5">
                    Requests: {key.requestUsed || 0}
                    {key.requestLimit > 0 ? ` / ${key.requestLimit} (remaining ${key.requestRemaining ?? 0})` : " / unlimited"}
                    {" • "}
                    Tokens: {key.tokenUsed || 0}
                    {key.tokenLimit > 0 ? ` / ${key.tokenLimit} (remaining ${key.tokenRemaining ?? 0})` : " / unlimited"}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5 break-all">
                    Allowed models: {Array.isArray(key.allowedModels) && key.allowedModels.length > 0 ? key.allowedModels.join(", ") : "all"}
                  </p>
                </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => openEditModal(key)}
                      className="p-2 hover:bg-primary/10 rounded text-primary"
                      title="Edit key"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button
                      onClick={() => openRotateModal(key)}
                      className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted"
                      title="Regenerate key"
                      disabled={key.isActive === false}
                    >
                      <span className="material-symbols-outlined text-[18px]">autorenew</span>
                    </button>
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500"
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
        size="full"
        onClose={closeCreateModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <Input
            label="Owner Name"
            value={newOwnerName}
            onChange={(e) => setNewOwnerName(e.target.value)}
            placeholder="Nguyen Van A"
          />
          <Input
            label="Owner Email"
            type="email"
            value={newOwnerEmail}
            onChange={(e) => setNewOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
          />
          <Input
            label="Owner Age"
            type="number"
            min="0"
            value={newOwnerAge}
            onChange={(e) => setNewOwnerAge(e.target.value)}
            placeholder="30"
          />
          <Input
            label="Request Limit (optional)"
            type="number"
            min="0"
            value={newRequestLimit}
            onChange={(e) => setNewRequestLimit(e.target.value)}
            hint="0 hoặc để trống = không giới hạn"
            placeholder="1000"
          />
          <Input
            label="Token Limit (optional)"
            type="number"
            min="0"
            value={newTokenLimit}
            onChange={(e) => setNewTokenLimit(e.target.value)}
            hint="0 hoặc để trống = không giới hạn"
            placeholder="1000000"
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-main">Allowed Models</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                  Selected {newAllowedModels.length} / {availableModels.length}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input
                value={newModelSearch}
                onChange={(e) => setNewModelSearch(e.target.value)}
                placeholder="Search models..."
                className="min-w-[200px]"
              />
              <select
                className="px-3 py-2 rounded-lg border border-border bg-bg text-sm"
                value={newModelProvider}
                onChange={(e) => setNewModelProvider(e.target.value)}
              >
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider === "all" ? "All providers" : provider}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setNewAllowedModels([])}
                className="text-xs text-text-muted hover:underline"
              >
                Allow all
              </button>
              <button
                type="button"
                onClick={() => setNewAllowedModels(filteredNewModels)}
                className="text-xs text-primary hover:underline"
                disabled={filteredNewModels.length === 0}
              >
                Select filtered
              </button>
              <button
                type="button"
                onClick={() => setNewAllowedModels([])}
                className="text-xs text-text-muted hover:underline"
              >
                Clear
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-black/10 dark:border-white/10 p-3 bg-white dark:bg-white/5">
              {modelsLoading ? (
                <p className="text-sm text-text-muted">Loading models...</p>
              ) : availableModels.length === 0 ? (
                <p className="text-sm text-text-muted">No models found.</p>
              ) : filteredNewModels.length === 0 ? (
                <p className="text-sm text-text-muted">No models match your filter.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredNewModels.map((modelId) => (
                    <label key={modelId} className="flex items-center gap-2 text-sm text-text-main">
                      <input
                        type="checkbox"
                        checked={newAllowedModels.includes(modelId)}
                        onChange={() => toggleAllowedModel(modelId, newAllowedModels, setNewAllowedModels)}
                        className="h-4 w-4"
                      />
                      <span className="break-all">{modelId}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-text-muted">Allow all = cho phép tất cả model</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={closeCreateModal}
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
        isOpen={showEditModal}
        title="Edit API Key"
        size="full"
        onClose={closeEditModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={editKeyName}
            onChange={(e) => setEditKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <Input
            label="Owner Name"
            value={editOwnerName}
            onChange={(e) => setEditOwnerName(e.target.value)}
            placeholder="Nguyen Van A"
          />
          <Input
            label="Owner Email"
            type="email"
            value={editOwnerEmail}
            onChange={(e) => setEditOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
          />
          <Input
            label="Owner Age"
            type="number"
            min="0"
            value={editOwnerAge}
            onChange={(e) => setEditOwnerAge(e.target.value)}
            placeholder="30"
          />
          <Input
            label="Request Limit (optional)"
            type="number"
            min="0"
            value={editRequestLimit}
            onChange={(e) => setEditRequestLimit(e.target.value)}
            hint="0 hoặc để trống = không giới hạn"
            placeholder="1000"
          />
          <Input
            label="Token Limit (optional)"
            type="number"
            min="0"
            value={editTokenLimit}
            onChange={(e) => setEditTokenLimit(e.target.value)}
            hint="0 hoặc để trống = không giới hạn"
            placeholder="1000000"
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-main">Allowed Models</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                  Selected {editAllowedModels.length} / {availableModels.length}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input
                value={editModelSearch}
                onChange={(e) => setEditModelSearch(e.target.value)}
                placeholder="Search models..."
                className="min-w-[200px]"
              />
              <select
                className="px-3 py-2 rounded-lg border border-border bg-bg text-sm"
                value={editModelProvider}
                onChange={(e) => setEditModelProvider(e.target.value)}
              >
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider === "all" ? "All providers" : provider}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setEditAllowedModels([])}
                className="text-xs text-text-muted hover:underline"
              >
                Allow all
              </button>
              <button
                type="button"
                onClick={() => setEditAllowedModels(filteredEditModels)}
                className="text-xs text-primary hover:underline"
                disabled={filteredEditModels.length === 0}
              >
                Select filtered
              </button>
              <button
                type="button"
                onClick={() => setEditAllowedModels([])}
                className="text-xs text-text-muted hover:underline"
              >
                Clear
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-black/10 dark:border-white/10 p-3 bg-white dark:bg-white/5">
              {modelsLoading ? (
                <p className="text-sm text-text-muted">Loading models...</p>
              ) : availableModels.length === 0 ? (
                <p className="text-sm text-text-muted">No models found.</p>
              ) : filteredEditModels.length === 0 ? (
                <p className="text-sm text-text-muted">No models match your filter.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredEditModels.map((modelId) => (
                    <label key={modelId} className="flex items-center gap-2 text-sm text-text-main">
                      <input
                        type="checkbox"
                        checked={editAllowedModels.includes(modelId)}
                        onChange={() => toggleAllowedModel(modelId, editAllowedModels, setEditAllowedModels)}
                        className="h-4 w-4"
                      />
                      <span className="break-all">{modelId}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-text-muted">Allow all = cho phép tất cả model</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleUpdateKey} fullWidth disabled={!editKeyName.trim()}>
              Save
            </Button>
            <Button onClick={closeEditModal} variant="ghost" fullWidth>
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

      <Modal
        isOpen={showRotateModal}
        onClose={closeRotateModal}
        title="Regenerate API Key"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeRotateModal} disabled={rotateLoading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleRotateKey} loading={rotateLoading}>
              Regenerate
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-text-muted">
            This will generate a new key value for this API key ID. Usage/quota and metadata
            (owner/limits/allowed models) will be kept.
          </p>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Grace period</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm"
              value={rotateGraceHours}
              onChange={(e) => setRotateGraceHours(Number(e.target.value))}
              disabled={rotateLoading}
            >
              <option value={0}>0h (immediate)</option>
              <option value={1}>1h</option>
              <option value={2}>2h (default)</option>
              <option value={24}>24h</option>
            </select>
            <p className="text-xs text-text-muted">
              Old key expires {formatRotateExpiry()}.
            </p>
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-text">
            Clients using the old key will continue to work until it expires. Disable or delete
            the key if you need to revoke access immediately.
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showHistoryModal}
        onClose={closeHistoryModal}
        title="API Key History"
        size="md"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase text-text-muted">Current key</div>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-text">{maskKeyValue(historyKey?.key)}</code>
              <span className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                historyKey?.isActive === false
                  ? "border-red-300/80 text-red-600 bg-red-50"
                  : "border-emerald-200 text-emerald-700 bg-emerald-50"
              }`}>
                {historyKey?.isActive === false ? "Disabled" : "Active"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase text-text-muted">Previous keys (grace)</div>
              <span className="text-xs text-text-muted">
                {Array.isArray(historyKey?.previousKeys) ? historyKey.previousKeys.length : 0} keys
              </span>
            </div>
            {Array.isArray(historyKey?.previousKeys) && historyKey.previousKeys.length > 0 ? (
              <div className="flex flex-col gap-2">
                {historyKey.previousKeys.map((entry) => {
                  const expiresAt = formatHistoryTime(entry.expiresAt);
                  const rotatedAt = formatHistoryTime(entry.rotatedAt);
                  const revokeId = `${historyKey.id}:${entry.keyHash}`;
                  return (
                    <div
                      key={`${entry.keyHash}-${entry.expiresAt}`}
                      className="flex items-center justify-between rounded-lg border border-border bg-bg-subtle/40 px-3 py-2"
                    >
                      <div className="flex flex-col gap-1">
                        <code className="text-xs font-mono text-text">{maskKeyValue(entry.keyHash)}</code>
                        <div className="text-[11px] text-text-muted">
                          Rotated {rotatedAt} • Expires {expiresAt}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openRevokeModal(historyKey.id, entry.keyHash)}
                        loading={revokeLoadingId === revokeId}
                      >
                        Revoke now
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-text-muted">No previous keys in grace period.</div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase text-text-muted">Rotation history</div>
            {Array.isArray(historyKey?.rotationHistory) && historyKey.rotationHistory.length > 0 ? (
              <div className="flex flex-col gap-2">
                {historyKey.rotationHistory.map((entry, index) => (
                  <div
                    key={`${entry.rotatedAt || ""}-${index}`}
                    className="rounded-lg border border-border bg-bg-subtle/20 px-3 py-2 text-xs"
                  >
                    <div className="font-medium text-text">
                      Rotated {formatHistoryTime(entry.rotatedAt)}
                    </div>
                    <div className="text-text-muted">
                      Grace {Number.isFinite(Number(entry.graceHours)) ? `${entry.graceHours}h` : "-"}
                      {entry.expiresAt ? ` • Expires ${formatHistoryTime(entry.expiresAt)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-muted">No rotation history yet.</div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={showRevokeModal}
        onClose={closeRevokeModal}
        onConfirm={() => handleRevokePreviousKey(revokeTarget?.keyId, revokeTarget?.keyHash)}
        title="Revoke previous key"
        message="This previous key will stop working immediately. This does not delete the API key or reset usage."
        confirmText="Revoke"
        cancelText="Cancel"
        variant="danger"
        loading={revokeLoadingId === `${revokeTarget?.keyId}:${revokeTarget?.keyHash}`}
      />

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

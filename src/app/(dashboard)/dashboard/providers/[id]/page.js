"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, Toggle, Select } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModels, setTestingModels] = useState(false);
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId]);
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId];
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();
  }, [fetchConnections, fetchAliases]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this connection?")) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections(connections.filter(c => c.id !== id));
      }
    } catch (error) {
      console.log("Error deleting connection:", error);
    }
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });
      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
      }
    } catch (error) {
      console.log("Error saving connection:", error);
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (conn1, conn2) => {
    if (!conn1 || !conn2) return;
    try {
      // If they have the same priority, we need to ensure the one moving up
      // gets a lower value than the one moving down.
      // We use a small offset which the backend re-indexing will fix.
      let p1 = conn2.priority;
      let p2 = conn1.priority;

      if (p1 === p2) {
        // If moving conn1 "up" (index decreases)
        const isConn1MovingUp = connections.indexOf(conn1) > connections.indexOf(conn2);
        if (isConn1MovingUp) {
          p1 = conn2.priority - 0.5;
        } else {
          p1 = conn2.priority + 0.5;
        }
      }

      await Promise.all([
        fetch(`/api/providers/${conn1.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: p1 }),
        }),
        fetch(`/api/providers/${conn2.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: p2 }),
        }),
      ]);
      await fetchConnections();
    } catch (error) {
      console.log("Error swapping priority:", error);
    }
  };

  const handleTestModels = async () => {
    if (testingModels) return;
    const conn = connections.find((c) => c.isActive !== false) || connections[0];
    if (!conn) return;
    setTestingModels(true);
    setModelTestResults({});
    try {
      const res = await fetch(`/api/providers/${conn.id}/test-models`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const map = {};
        for (const r of data.results || []) map[r.modelId] = r.ok ? "ok" : "error";
        setModelTestResults(map);
      }
    } catch {
      // silent fail
    } finally {
      setTestingModels(false);
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    if (providerInfo.passthroughModels) {
      return (
        <PassthroughModelsSection
          providerAlias={providerAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
        />
      );
    }
    // Custom models added by user (stored as aliases: modelId → providerAlias/modelId)
    const customModels = Object.entries(modelAliases)
      .filter(([alias, fullModel]) => {
        const prefix = `${providerStorageAlias}/`;
        if (!fullModel.startsWith(prefix)) return false;
        const modelId = fullModel.slice(prefix.length);
        // Only show if not already in hardcoded list
        return !models.some((m) => m.id === modelId) && alias === modelId;
      })
      .map(([alias, fullModel]) => ({
        id: fullModel.slice(`${providerStorageAlias}/`.length),
        alias,
        fullModel,
      }));

    return (
      <div className="flex flex-wrap gap-3">
        {models.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
            />
          );
        })}

        {/* Custom models inline */}
        {customModels.map((model) => (
          <ModelRow
            key={model.id}
            model={{ id: model.id }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => handleDeleteAlias(model.alias)}
            isCustom
          />
        ))}

        {/* Add model button — inline, same style as model chips */}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
}

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return `/providers/${providerInfo.id}.png`;
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex items-center gap-4">
          <div
            className="rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath()}
                alt={providerInfo.name}
                width={48}
                height={48}
                className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{providerInfo.name}</h1>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {isCompatible && providerNode && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                icon="add"
                onClick={() => setShowAddApiKeyModal(true)}
                disabled={connections.length > 0}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={async () => {
                  if (!confirm(`Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`)) return;
                  try {
                    const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                    if (res.ok) {
                      router.push("/dashboard/providers");
                    }
                  } catch (error) {
                    console.log("Error deleting provider node:", error);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
          {connections.length > 0 && (
            <p className="text-sm text-text-muted">
              Only one connection is allowed per compatible node. Add another node if you need more connections.
            </p>
          )}
        </Card>
      )}

      {/* Connections */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connections</h2>
          {!isCompatible && (
            <Button
              size="sm"
              icon="add"
              onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}
            >
              Add
            </Button>
          )}
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">{isOAuth ? "lock" : "key"}</span>
            </div>
            <p className="text-text-main font-medium mb-1">No connections yet</p>
            <p className="text-sm text-text-muted mb-4">Add your first connection to get started</p>
            {!isCompatible && (
              <Button icon="add" onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}>
                Add Connection
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {connections
              .sort((a, b) => (a.priority || 0) - (b.priority || 0))
              .map((conn, index) => (
              <ConnectionRow
                key={conn.id}
                connection={conn}
                isOAuth={isOAuth}
                isFirst={index === 0}
                isLast={index === connections.length - 1}
                onMoveUp={() => handleSwapPriority(conn, connections[index - 1])}
                onMoveDown={() => handleSwapPriority(conn, connections[index + 1])}
                onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                onEdit={() => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                onDelete={() => handleDelete(conn.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Models */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {providerInfo.passthroughModels ? "Model Aliases" : "Available Models"}
          </h2>
          {connections.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon="science"
              loading={testingModels}
              onClick={handleTestModels}
              disabled={testingModels}
            >
              {testingModels ? "Testing…" : "Test Models"}
            </Button>
          )}
        </div>
        {renderModelsSection()}
      </Card>

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddApiKeyModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && !providerInfo?.passthroughModels && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId) => {
            await handleSetAlias(modelId, modelId, providerStorageAlias);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}
    </div>
  );
}

function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, onDeleteAlias }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group flex items-center gap-2 px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
      <button
        onClick={() => onCopy(fullModel, `model-${model.id}`)}
        className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
        title="Copy model"
      >
        <span className="material-symbols-outlined text-sm">
          {copied === `model-${model.id}` ? "check" : "content_copy"}
        </span>
      </button>
      {isCustom && (
        <button
          onClick={onDeleteAlias}
          className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
          title="Remove custom model"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      )}
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
};

function PassthroughModelsSection({ providerAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);

  // Filter aliases for this provider - models are persisted via alias
  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerAlias}/`, ""),
    fullModel,
    alias,
  }));

  // Generate default alias from modelId (last part after /)
  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const defaultAlias = generateDefaultAlias(modelId);
    
    // Check if alias already exists
    if (modelAliases[defaultAlias]) {
      alert(`Alias "${defaultAlias}" already exists. Please use a different model or edit existing alias.`);
      return;
    }
    
    setAdding(true);
    try {
      await onSetAlias(modelId, defaultAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
};

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-sidebar/50">
      <span className="material-symbols-outlined text-base text-text-muted">smart_toy</span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>

        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <button
            onClick={() => onCopy(fullModel, `model-${modelId}`)}
            className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            title="Copy model"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${modelId}` ? "check" : "content_copy"}
            </span>
          </button>
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

PassthroughModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
};

function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerStorageAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerStorageAlias}/`, ""),
    fullModel,
    alias,
  }));

  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const resolveAlias = (modelId) => {
    const baseAlias = generateDefaultAlias(modelId);
    if (!modelAliases[baseAlias]) return baseAlias;
    const prefixedAlias = `${providerDisplayAlias}-${baseAlias}`;
    if (!modelAliases[prefixedAlias]) return prefixedAlias;
    return null;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      alert("All suggested aliases already exist. Please choose a different model or remove conflicting aliases.");
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={`${providerDisplayAlias}/${modelId}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};

function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const secs = Math.floor(diff / 1000);
      if (secs < 60) {
        setRemaining(`${secs}s`);
      } else if (secs < 3600) {
        setRemaining(`${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(`${hrs}h ${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  return (
    <span className="text-xs text-orange-500 font-mono">
      ⏱ {remaining}
    </span>
  );
}

CooldownTimer.propTypes = {
  until: PropTypes.string.isRequired,
};

function ConnectionRow({ connection, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onEdit, onDelete }) {
  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired → treat as active
    : connection.testStatus;

  const getStatusVariant = () => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
    return "default";
  };

  return (
    <div className={`group flex items-center justify-between p-3 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Priority arrows */}
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-text-muted">
          {isOAuth ? "lock" : "key"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
        <div className="flex gap-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded text-red-500">
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    priority: 1,
  });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Production Key"
        />
        <div className="flex gap-2">
          <Input
            label="API Key"
            type="password"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            {isAnthropic 
              ? `Validation checks ${providerName || "Anthropic Compatible"} by verifying the API key.`
              : `Validation checks ${providerName || "OpenAI Compatible"} via /models on your base URL.`
            }
          </p>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function EditConnectionModal({ isOpen, connection, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
      });
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection]);

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const updates = { name: formData.name, priority: formData.priority };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const res = await fetch("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
            });
            const data = await res.json();
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  const isOAuth = connection.authType === "oauth";
  const isCompatible = isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider);

  return (
    <Modal isOpen={isOpen} title="Edit Connection" onClose={onClose}>
      <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? "Account name" : "Production Key"}
          />
        {isOAuth && connection.email && (
          <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">Email</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label="API Key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Enter new API key"
                hint="Leave blank to keep the current API key."
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
            )}
          </>
        )}

        {/* Test Connection */}
        {!isCompatible && (
          <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && (
              <Badge variant={testResult === "success" ? "success" : "error"}>
                {testResult === "success" ? "Valid" : "Failed"}
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

EditConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    authType: PropTypes.string,
    provider: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          baseUrl: formData.baseUrl, 
          apiKey: checkKey, 
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible" 
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};

function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setModelId(""); setTestStatus(null); setTestError(""); }
  }, [isOpen]);

  const handleTest = async () => {
    if (!modelId.trim()) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId.trim()}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    if (!modelId.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(modelId.trim());
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              autoFocus
            />
            <Button
              variant="secondary"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{modelId.trim() || "model-id"}</code>
          </p>
        </div>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};


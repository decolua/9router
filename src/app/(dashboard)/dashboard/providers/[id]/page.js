"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, Toggle, Select } from "@/shared/components";
import { FREE_PROVIDERS, OAUTH_PROVIDERS, APIKEY_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useTranslations } from "next-intl";

export default function ProviderDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? t("providers.anthropicCompatible") : t("providers.openaiCompatible")),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (FREE_PROVIDERS[providerId] || OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId]);
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
  }, [providerId]);

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
          alert(data.error || t("providers.messages.setAliasFailed"));
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
    if (!confirm(t("providers.messages.deleteConnectionConfirm"))) return;
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
    if (models.length === 0) {
      return <p className="text-sm text-text-muted">{t("providers.messages.noModelsConfigured")}</p>;
    }
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
            />
          );
        })}
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
        <p className="text-text-muted">{t("providers.messages.notFound")}</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          {t("providers.messages.backToProviders")}
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
          {t("providers.messages.backToProviders")}
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
              {t("providers.messages.connectionCount", { count: connections.length })}
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
                {isAnthropicCompatible ? t("providers.messages.apiTypeMessages") : (providerNode.apiType === "responses" ? t("providers.messages.apiTypeResponses") : t("providers.messages.apiTypeChatCompletions"))} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
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
                {t("common.add")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
              >
                {t("common.edit")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={async () => {
                  if (!confirm(t("providers.messages.deleteCompatibleConfirm", { type: isAnthropicCompatible ? t("providers.anthropicCompatible") : t("providers.openaiCompatible") }))) return;
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
                {t("common.delete")}
              </Button>
            </div>
          </div>
          {connections.length > 0 && (
            <p className="text-sm text-text-muted">
              {t("providers.messages.oneConnectionLimit")}
            </p>
          )}
        </Card>
      )}

      {/* Connections */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("providers.messages.connectionsTitle")}</h2>
          {!isCompatible && (
            <div className="flex items-center gap-2">
              {!isOAuth && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="upload"
                  onClick={() => setShowImportModal(true)}
                >
                  {t("providers.messages.import")}
                </Button>
              )}
              <Button
                size="sm"
                icon="add"
                onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}
              >
                {t("common.add")}
              </Button>
            </div>
          )}
        </div>

        {connections.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
                <span className="material-symbols-outlined text-[32px]">{isOAuth ? "lock" : "key"}</span>
              </div>
              <p className="text-text-main font-medium mb-1">{t("providers.messages.emptyConnectionsTitle")}</p>
              <p className="text-sm text-text-muted mb-4">{t("providers.messages.emptyConnectionsSubtitle")}</p>
              {!isCompatible && (
                <div className="flex items-center justify-center gap-2">
                  {!isOAuth && (
                    <Button variant="secondary" icon="upload" onClick={() => setShowImportModal(true)}>
                      {t("providers.messages.importJson")}
                    </Button>
                  )}
                  <Button icon="add" onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}>
                    {t("providers.messages.addConnection")}
                  </Button>
                </div>
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
        <h2 className="text-lg font-semibold mb-4">
          {providerInfo.passthroughModels ? t("providers.messages.modelAliases") : t("providers.messages.availableModels")}
        </h2>
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
      <ImportApiKeysModal
        isOpen={showImportModal}
        providerId={providerId}
        providerName={providerInfo.name}
        onImported={fetchConnections}
        onClose={() => setShowImportModal(false)}
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
    </div>
  );
}

function ModelRow({ model, fullModel, alias, copied, onCopy }) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-sidebar/50">
      <span className="material-symbols-outlined text-base text-text-muted">smart_toy</span>
      <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
      <button
        onClick={() => onCopy(fullModel, `model-${model.id}`)}
        className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
        title={t("providers.messages.copyModel")}
      >
        <span className="material-symbols-outlined text-sm">
          {copied === `model-${model.id}` ? "check" : "content_copy"}
        </span>
      </button>
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
};

function PassthroughModelsSection({ providerAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias }) {
  const t = useTranslations();
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
      alert(t("providers.messages.aliasExists", { alias: defaultAlias }));
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
        {t("providers.messages.passthroughHint")}
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">{t("providers.messages.modelIdFromOpenRouter")}</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={t("providers.messages.modelIdPlaceholder")}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? t("providers.messages.adding") : t("common.add")}
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
  const t = useTranslations();
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
            title={t("providers.messages.copyModel")}
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
        title={t("providers.messages.removeModel")}
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
  const t = useTranslations();
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
      alert(t("providers.messages.aliasSuggestionsUsed"));
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
        alert(data.error || t("providers.messages.importModelsFailed"));
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert(t("providers.messages.noModelsReturned"));
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
        alert(t("providers.messages.noNewModels"));
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
        {t("providers.messages.addCompatibleModels", { type: isAnthropic ? t("providers.anthropicCompatible") : t("providers.openaiCompatible") })}
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">{t("providers.messages.modelId")}</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? t("providers.messages.anthropicModelPlaceholder") : t("providers.messages.openaiModelPlaceholder")}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? t("providers.messages.adding") : t("common.add")}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? t("providers.messages.importing") : t("providers.messages.importFromModels")}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          {t("providers.messages.addConnectionToImport")}
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
  const t = useTranslations();
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
        setRemaining(t("providers.messages.cooldownSeconds", { count: secs }));
      } else if (secs < 3600) {
        setRemaining(t("providers.messages.cooldownMinutes", { minutes: Math.floor(secs / 60), seconds: secs % 60 }));
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(t("providers.messages.cooldownHours", { hours: hrs, minutes: mins }));
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
  const t = useTranslations();
  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || t("providers.messages.oauthAccount")
    : connection.name;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  useEffect(() => {
    const checkCooldown = () => {
      const cooldown = connection.rateLimitedUntil &&
        new Date(connection.rateLimitedUntil).getTime() > Date.now();
      setIsCooldown(cooldown);
    };

    checkCooldown();
    // Update every second while in cooldown
    const interval = connection.rateLimitedUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connection.rateLimitedUntil]);

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

  const statusLabel = () => {
    if (connection.isActive === false) return t("providers.messages.statusDisabled");
    if (!effectiveStatus) return t("providers.messages.statusUnknown");
    if (effectiveStatus === "active") return t("providers.messages.statusActive");
    if (effectiveStatus === "success") return t("providers.messages.statusSuccess");
    if (effectiveStatus === "error") return t("providers.messages.statusError");
    if (effectiveStatus === "expired") return t("providers.messages.statusExpired");
    if (effectiveStatus === "unavailable") return t("providers.messages.statusUnavailable");
    return effectiveStatus;
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
              {statusLabel()}
            </Badge>
            {isCooldown && connection.isActive !== false && <CooldownTimer until={connection.rateLimitedUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">{t("providers.messages.autoPriority", { value: connection.globalPriority })}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? t("providers.messages.disableConnection") : t("providers.messages.enableConnection")}
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
    rateLimitedUntil: PropTypes.string,
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
  const t = useTranslations();
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
          label={t("providers.messages.name")}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t("providers.messages.namePlaceholder")}
        />
        <div className="flex gap-2">
          <Input
            label={t("providers.messages.apiKey")}
            type="password"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? t("providers.messages.checking") : t("providers.messages.check")}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? t("providers.messages.valid") : t("providers.messages.invalid")}
          </Badge>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            {isAnthropic 
              ? t("providers.messages.validateAnthropic", { name: providerName || t("providers.anthropicCompatible") })
              : t("providers.messages.validateOpenAI", { name: providerName || t("providers.openaiCompatible") })
            }
          </p>
        )}
        <Input
          label={t("providers.messages.priority")}
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {t("common.cancel")}
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

function ImportApiKeysModal({ isOpen, providerId, providerName, onImported, onClose }) {
  const t = useTranslations();
  const [rawText, setRawText] = useState("");
  const [items, setItems] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setRawText("");
    setItems([]);
    setParseError(null);
    setResult(null);
    setImporting(false);
    setFileInputKey((prev) => prev + 1);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const text = rawText.trim();
    if (!text) {
      setItems([]);
      setParseError(null);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setItems([]);
      setParseError(t("providers.messages.invalidJson"));
      return;
    }

    const list = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.connections) ? parsed.connections : Array.isArray(parsed.items) ? parsed.items : null);

    if (!list) {
      setItems([]);
      setParseError(t("providers.messages.jsonFormatHint"));
      return;
    }

    const normalized = [];
    const errors = [];
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push(t("providers.messages.importRowInvalid", { row: index + 1 }));
        return;
      }

      if (entry.provider && entry.provider !== providerId) {
        errors.push(t("providers.messages.importRowProvider", { row: index + 1, provider: providerId }));
        return;
      }

      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const apiKey = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
      if (!name || !apiKey) {
        errors.push(t("providers.messages.importRowMissing", { row: index + 1 }));
        return;
      }

      const item = { name, apiKey };
      if (entry.priority !== undefined) {
        const priority = Number.parseInt(entry.priority, 10);
        if (Number.isNaN(priority)) {
          errors.push(t("providers.messages.importRowPriority", { row: index + 1 }));
          return;
        }
        item.priority = priority;
      }
      if (entry.globalPriority !== undefined) {
        const globalPriority = Number.parseInt(entry.globalPriority, 10);
        if (Number.isNaN(globalPriority)) {
          errors.push(t("providers.messages.importRowGlobalPriority", { row: index + 1 }));
          return;
        }
        item.globalPriority = globalPriority;
      }
      if (entry.defaultModel !== undefined) {
        item.defaultModel = String(entry.defaultModel);
      }
      if (entry.testStatus !== undefined) {
        item.testStatus = String(entry.testStatus);
      }

      normalized.push(item);
    });

    setItems(normalized);
    if (errors.length) {
      const head = errors.slice(0, 3).join(" | ");
      setParseError(errors.length > 3 ? t("providers.messages.importRowMore", { head, count: errors.length - 3 }) : head);
    } else {
      setParseError(null);
    }
  }, [rawText, isOpen, providerId]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawText(text);
    } catch {
      setParseError(t("providers.messages.readFileFailed"));
    }
  };

  const handleImport = async () => {
    if (!items.length || parseError) return;
    setImporting(true);
    setResult(null);
    const failures = [];
    let success = 0;

    for (const entry of items) {
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, ...entry }),
        });
        if (res.ok) {
          success += 1;
        } else {
          const data = await res.json().catch(() => ({}));
          failures.push({ name: entry.name, error: data.error || t("providers.messages.importFailed") });
        }
      } catch {
        failures.push({ name: entry.name, error: t("providers.messages.importFailed") });
      }
    }

    setResult({ success, total: items.length, failures });
    setImporting(false);
    if (success > 0) {
      onImported();
    }
  };

  const maskKey = (value) => {
    if (!value || value.length < 8) return "****";
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  };

  return (
    <Modal isOpen={isOpen} title={t("providers.messages.importTitle", { name: providerName || providerId })} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <div className="text-sm text-text-muted">
          {t("providers.messages.importDesc")}
        </div>

        <Card.Section>
          <div className="flex flex-col gap-3">
            <div className="text-xs text-text-muted">{t("providers.messages.example")}</div>
            <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 p-3 font-mono text-xs whitespace-pre-wrap">
{`[
  { "name": "Primary", "apiKey": "sk-...", "priority": 1 },
  { "name": "Backup", "apiKey": "sk-...", "priority": 2 }
]`}
            </div>
          </div>
        </Card.Section>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-text-main">{t("providers.messages.jsonFile")}</label>
          <input
            key={fileInputKey}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="block w-full text-sm text-text-muted file:mr-4 file:py-2 file:px-3 file:rounded-md file:border file:border-black/10 dark:file:border-white/10 file:bg-white dark:file:bg-white/10 file:text-sm file:font-medium file:text-text-main hover:file:bg-black/5 dark:hover:file:bg-white/20"
          />
          <div className="text-xs text-text-muted">{t("providers.messages.parseLocalOnly")}</div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-text-main">{t("providers.messages.pasteJson")}</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={6}
            placeholder={t("providers.messages.pasteJsonPlaceholder")}
            className="w-full rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-3 text-sm text-text-main placeholder-text-muted/60 focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none"
          />
        </div>

        {parseError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {parseError}
          </div>
        )}

        {items.length > 0 && (
          <Card.Section className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t("providers.messages.preview", { count: items.length })}</div>
            <div className="flex flex-col gap-1">
              {items.slice(0, 5).map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between text-xs text-text-muted">
                  <span className="font-medium text-text-main">{item.name}</span>
                  <span className="font-mono">{maskKey(item.apiKey)}</span>
                </div>
              ))}
              {items.length > 5 && (
                <div className="text-xs text-text-muted">{t("providers.messages.moreItems", { count: items.length - 5 })}</div>
              )}
            </div>
          </Card.Section>
        )}

        {result && (
          <Card.Section className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t("providers.messages.importResult")}</div>
            <div className="text-sm text-text-muted">
              {t("providers.messages.importResultSummary", { success: result.success, total: result.total })}
            </div>
            {result.failures.length > 0 && (
              <div className="text-xs text-red-500">
                {result.failures.slice(0, 5).map((failure, index) => (
                  <div key={`${failure.name}-${index}`}>• {failure.name}: {failure.error}</div>
                ))}
                {result.failures.length > 5 && (
                  <div>{t("providers.messages.moreItems", { count: result.failures.length - 5 })}</div>
                )}
              </div>
            )}
          </Card.Section>
        )}

        <div className="flex gap-2">
          <Button onClick={handleImport} fullWidth loading={importing} disabled={!items.length || !!parseError}>
            {t("providers.messages.import")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth disabled={importing}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ImportApiKeysModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerId: PropTypes.string.isRequired,
  providerName: PropTypes.string,
  onImported: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function EditConnectionModal({ isOpen, connection, onSave, onClose }) {
  const t = useTranslations();
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
    <Modal isOpen={isOpen} title={t("providers.messages.editConnection")} onClose={onClose}>
      <div className="flex flex-col gap-4">
          <Input
            label={t("providers.messages.name")}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? t("providers.messages.accountNamePlaceholder") : t("providers.messages.namePlaceholder")}
          />
        {isOAuth && connection.email && (
          <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">{t("providers.messages.email")}</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        )}
        <Input
          label={t("providers.messages.priority")}
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label={t("providers.messages.apiKey")}
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={t("providers.messages.newApiKeyPlaceholder")}
                hint={t("providers.messages.keepApiKeyHint")}
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? t("providers.messages.checking") : t("providers.messages.check")}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? t("providers.messages.valid") : t("providers.messages.invalid")}
              </Badge>
            )}
          </>
        )}

        {/* Test Connection */}
        {!isCompatible && (
          <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? t("providers.messages.testing") : t("providers.messages.testConnection")}
            </Button>
            {testResult && (
              <Badge variant={testResult === "success" ? "success" : "error"}>
                {testResult === "success" ? t("providers.messages.valid") : t("providers.messages.failed")}
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>{t("common.cancel")}</Button>
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
  const t = useTranslations();
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
    { value: "chat", label: t("providers.messages.apiTypeChatCompletions") },
    { value: "responses", label: t("providers.messages.apiTypeResponses") },
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
    <Modal isOpen={isOpen} title={t("providers.messages.editCompatibleTitle", { type: isAnthropic ? t("providers.anthropicCompatible") : t("providers.openaiCompatible") })} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label={t("providers.messages.name")}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isAnthropic ? t("providers.messages.anthropicNamePlaceholder") : t("providers.messages.openaiNamePlaceholder")}
          hint={t("providers.messages.requiredLabel")}
        />
        <Input
          label={t("providers.messages.prefix")}
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? t("providers.messages.anthropicPrefixPlaceholder") : t("providers.messages.openaiPrefixPlaceholder")}
          hint={t("providers.messages.prefixHint")}
        />
        {!isAnthropic && (
          <Select
            label={t("providers.messages.apiType")}
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label={t("providers.messages.baseUrl")}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? t("providers.messages.anthropicBaseUrlPlaceholder") : t("providers.messages.openaiBaseUrlPlaceholder")}
          hint={isAnthropic ? t("providers.messages.anthropicBaseUrlHint") : t("providers.messages.openaiBaseUrlHint")}
        />
        <div className="flex gap-2">
          <Input
            label={t("providers.messages.apiKeyCheck")}
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? t("providers.messages.checking") : t("providers.messages.check")}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? t("providers.messages.valid") : t("providers.messages.invalid")}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? t("providers.messages.saving") : t("common.save")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {t("common.cancel")}
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

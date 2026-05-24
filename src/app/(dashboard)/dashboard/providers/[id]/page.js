"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CardSkeleton } from "@/shared/components";
import {
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OAUTH_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import BulkProxyAssignmentModal from "./components/BulkProxyAssignmentModal";
import CompatibleProviderDetailsCard from "./components/CompatibleProviderDetailsCard";
import ProviderConnectionsCard from "./components/ProviderConnectionsCard";
import ProviderDetailModals from "./components/ProviderDetailModals";
import ProviderHeaderCard from "./components/ProviderHeaderCard";
import ProviderModelsCard from "./components/ProviderModelsCard";
import ProviderNoticeBanner from "./components/ProviderNoticeBanner";
import { useProviderDetailConnections } from "./hooks/useProviderDetailConnections";
import { useProviderDetailModels } from "./hooks/useProviderDetailModels";
import {
  createProviderConnection,
  deleteProviderNode,
  updateProviderConnection,
  updateProviderNode,
} from "./utils/providerDetailPageApi";

function getHeaderIconPath(
  providerInfo,
  isOpenAICompatible,
  isAnthropicCompatible,
) {
  if (isOpenAICompatible && providerInfo.apiType) {
    return providerInfo.apiType === "responses"
      ? "/providers/oai-r.png"
      : "/providers/oai-cc.png";
  }
  if (isAnthropicCompatible) {
    return "/providers/anthropic-m.png";
  }
  return `/providers/${providerInfo.id}.png`;
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const [providerNode, setProviderNode] = useState(null);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [thinkingMode, setThinkingMode] = useState("auto");
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const authCompatibility = {
    isOpenAICompatible: isOpenAICompatibleProvider(providerId),
    isAnthropicCompatible: isAnthropicCompatibleProvider(providerId),
  };
  const isCompatible =
    authCompatibility.isOpenAICompatible ||
    authCompatibility.isAnthropicCompatible;

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name:
          providerNode.name ||
          (providerNode.type === "anthropic-compatible"
            ? "Anthropic Compatible"
            : "OpenAI Compatible"),
        color:
          providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : OAUTH_PROVIDERS[providerId] ||
      APIKEY_PROVIDERS[providerId] ||
      FREE_PROVIDERS[providerId] ||
      FREE_TIER_PROVIDERS[providerId] ||
      WEB_COOKIE_PROVIDERS[providerId];
  const authModes = providerInfo?.authModes || [];
  const isOAuth =
    !!OAUTH_PROVIDERS[providerId] ||
    !!FREE_PROVIDERS[providerId] ||
    authModes.includes("oauth");
  const supportsApiKeyAuth =
    !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel =
    providerId === "xai" ? "Grok Build OAuth" : "OAuth";
  const apiKeyConnectionLabel =
    providerId === "xai" ? "xAI API Key" : "API Key";
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? providerNode?.prefix || providerId
    : providerAlias;

  const {
    modelAliases,
    modelsTestError,
    testingModelId,
    modelTestResults,
    suggestedModels,
    kiloFreeModels,
    disabledModelIds,
    fetchDisabledModels,
    handleDisableModel,
    handleEnableModel,
    handleDisableAll,
    handleEnableAll,
    fetchAliases,
    loadSuggestedModels,
    handleSetAlias,
    handleDeleteAlias,
    handleTestModel,
  } = useProviderDetailModels({
    providerId,
    providerStorageAlias,
    providerAlias,
  });

  const {
    connections,
    setConnections,
    loading,
    proxyPools,
    selectedConnectionIds,
    showBulkProxyModal,
    bulkUpdatingProxy,
    providerStrategy,
    providerStickyLimit,
    connectionsSortDirection,
    oneByOneRunning,
    oneByOneStopping,
    oneByOneCurrentConnectionId,
    oneByOneResults,
    oneByOneSummary,
    manualRefreshResults,
    manualRefreshing,
    manualRefreshSummary,
    fetchConnections,
    displayedConnections,
    isConnectionsSortActive,
    handleToggleConnectionsSort,
    handleRoundRobinToggle,
    handleStickyLimitChange,
    handleRunOneByOneTest,
    handleStopOneByOneTest,
    handleDeleteConnection,
    handleUpdateConnectionStatus,
    handleSwapPriority,
    setSelectedConnectionsAutoRefresh,
    copySelectedEmails,
    toggleSelectConnection,
    selectedConnections,
    allSelected,
    selectedAutoRefreshSummary,
    toggleSelectAllConnections,
    clearSelection,
    selectionSummary,
    autoRefreshSummary,
    selectedEmailSummary,
    openBulkProxyModal,
    closeBulkProxyModal,
    handleApplySinglePool,
    activePools,
    handleApplyOneToOne,
    isSelected,
    handleManualRefreshSelected,
    clearManualRefreshResults,
    handleUpdateProxy,
  } = useProviderDetailConnections({
    providerId,
    isCompatible,
    onProviderNodeLoaded: setProviderNode,
    onThinkingModeLoaded: setThinkingMode,
  });

  const openOAuthConnection = () => {
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed =
        window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = () => {
    if (isOAuth) {
      triggerOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    fetchAliases();
    fetchDisabledModels();
  }, [fetchAliases, fetchDisabledModels]);

  useEffect(() => {
    const fetcher = (
      OAUTH_PROVIDERS[providerId] ||
      APIKEY_PROVIDERS[providerId] ||
      FREE_PROVIDERS[providerId] ||
      FREE_TIER_PROVIDERS[providerId]
    )?.modelsFetcher;
    loadSuggestedModels(fetcher);
  }, [providerId, loadSuggestedModels]);

  const handleUpdateNode = async (formData) => {
    try {
      const { res, data } = await updateProviderNode(providerId, formData);
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const { res, data } = await createProviderConnection(
        providerId,
        formData,
      );

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.log("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await updateProviderConnection(
        selectedConnection.id,
        formData,
      );
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
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
      <div className="py-20 text-center">
        <p className="text-text-muted">Provider not found</p>
        <Link
          href="/dashboard/providers"
          className="mt-4 inline-block text-primary"
        >
          Back to Providers
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      <ProviderHeaderCard
        providerInfo={providerInfo}
        connectionsCount={connections.length}
        headerImgError={headerImgError}
        onHeaderImgError={() => setHeaderImgError(true)}
        getHeaderIconPath={() =>
          getHeaderIconPath(
            providerInfo,
            authCompatibility.isOpenAICompatible,
            authCompatibility.isAnthropicCompatible,
          )
        }
      />

      <ProviderNoticeBanner providerInfo={providerInfo} />

      {isCompatible && providerNode && (
        <CompatibleProviderDetailsCard
          isAnthropicCompatible={authCompatibility.isAnthropicCompatible}
          providerNode={providerNode}
          onAddApiKey={() => {
            setAddConnectionError("");
            setShowAddApiKeyModal(true);
          }}
          onEdit={() => setShowEditNodeModal(true)}
          onDelete={() => {
            setConfirmState({
              title: "Delete Compatible Node",
              message: `Delete this ${authCompatibility.isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
              onConfirm: async () => {
                setConfirmState(null);
                try {
                  const res = await deleteProviderNode(providerId);
                  if (res.ok) {
                    router.push("/dashboard/providers");
                  }
                } catch (error) {
                  console.log("Error deleting provider node:", error);
                }
              },
            });
          }}
        />
      )}

      <ProviderConnectionsCard
        providerId={providerId}
        isFreeNoAuth={isFreeNoAuth}
        isOAuth={isOAuth}
        isCompatible={isCompatible}
        hasDualAuthModes={hasDualAuthModes}
        oauthConnectionLabel={oauthConnectionLabel}
        apiKeyConnectionLabel={apiKeyConnectionLabel}
        connections={connections}
        displayedConnections={displayedConnections}
        proxyPools={proxyPools}
        selectedConnectionIds={selectedConnectionIds}
        allSelected={allSelected}
        selectionSummary={selectionSummary}
        autoRefreshSummary={autoRefreshSummary}
        selectedAutoRefreshSummary={selectedAutoRefreshSummary}
        selectedEmailSummary={selectedEmailSummary}
        selectedConnections={selectedConnections}
        manualRefreshing={manualRefreshing}
        manualRefreshResults={manualRefreshResults}
        manualRefreshSummary={manualRefreshSummary}
        isConnectionsSortActive={isConnectionsSortActive}
        connectionsSortDirection={connectionsSortDirection}
        oneByOneRunning={oneByOneRunning}
        oneByOneStopping={oneByOneStopping}
        oneByOneCurrentConnectionId={oneByOneCurrentConnectionId}
        oneByOneResults={oneByOneResults}
        oneByOneSummary={oneByOneSummary}
        providerStrategy={providerStrategy}
        providerStickyLimit={providerStickyLimit}
        isSelected={isSelected}
        toggleSelectConnection={toggleSelectConnection}
        toggleSelectAllConnections={toggleSelectAllConnections}
        setSelectedConnectionsAutoRefresh={setSelectedConnectionsAutoRefresh}
        handleManualRefreshSelected={handleManualRefreshSelected}
        copySelectedEmails={copySelectedEmails}
        clearSelection={clearSelection}
        clearManualRefreshResults={clearManualRefreshResults}
        handleToggleConnectionsSort={handleToggleConnectionsSort}
        handleRunOneByOneTest={handleRunOneByOneTest}
        handleStopOneByOneTest={handleStopOneByOneTest}
        openBulkProxyModal={openBulkProxyModal}
        handleRoundRobinToggle={handleRoundRobinToggle}
        handleStickyLimitChange={handleStickyLimitChange}
        handleSwapPriority={handleSwapPriority}
        handleUpdateConnectionStatus={handleUpdateConnectionStatus}
        handleUpdateProxy={handleUpdateProxy}
        handleDeleteConnection={handleDeleteConnection}
        onOpenEditConnection={(conn) => {
          setSelectedConnection(conn);
          setShowEditModal(true);
        }}
        onTriggerOAuthConnection={triggerOAuthConnection}
        onTriggerApiKeyConnection={triggerApiKeyConnection}
        onTriggerAddConnection={triggerAddConnection}
        onOpenIFlowCookieModal={() => setShowIFlowCookieModal(true)}
      />

      <ProviderModelsCard
        isCompatible={isCompatible}
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        modelAliases={modelAliases}
        copied={copied}
        copy={copy}
        handleSetAlias={handleSetAlias}
        handleDeleteAlias={handleDeleteAlias}
        connections={connections}
        isAnthropicCompatible={authCompatibility.isAnthropicCompatible}
        models={models}
        kiloFreeModels={kiloFreeModels}
        disabledModelIds={disabledModelIds}
        modelsTestError={modelsTestError}
        providerInfo={providerInfo}
        modelTestResults={modelTestResults}
        isFreeNoAuth={isFreeNoAuth}
        testingModelId={testingModelId}
        handleTestModel={handleTestModel}
        handleDisableModel={handleDisableModel}
        suggestedModels={suggestedModels}
        setShowAddCustomModel={setShowAddCustomModel}
        handleEnableModel={handleEnableModel}
        handleEnableAll={() => {
          handleEnableAll();
        }}
        handleDisableAll={(ids) => {
          setConfirmState({
            title: "Disable All Models",
            message: `Disable all ${ids.length} model(s)?`,
            onConfirm: async () => {
              setConfirmState(null);
              try {
                const res = await handleDisableAll(ids);
                if (res.ok) await fetchDisabledModels();
              } catch (error) {
                console.log("Error disabling all models:", error);
              }
            },
          });
        }}
        providerId={providerId}
      />

      <BulkProxyAssignmentModal
        isOpen={showBulkProxyModal}
        onClose={closeBulkProxyModal}
        connectionsCount={connections.length}
        bulkUpdatingProxy={bulkUpdatingProxy}
        activePools={activePools}
        proxyPools={proxyPools}
        handleApplyOneToOne={handleApplyOneToOne}
        handleApplySinglePool={handleApplySinglePool}
      />

      <ProviderDetailModals
        providerId={providerId}
        providerInfo={providerInfo}
        providerNode={providerNode}
        isCompatible={isCompatible}
        isAnthropicCompatible={authCompatibility.isAnthropicCompatible}
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        proxyPools={proxyPools}
        showOAuthModal={showOAuthModal}
        onCloseOAuthModal={() => setShowOAuthModal(false)}
        onOAuthSuccess={handleOAuthSuccess}
        showIFlowCookieModal={showIFlowCookieModal}
        onCloseIFlowCookieModal={() => setShowIFlowCookieModal(false)}
        onIFlowCookieSuccess={handleIFlowCookieSuccess}
        showAddApiKeyModal={showAddApiKeyModal}
        addConnectionError={addConnectionError}
        onSaveApiKey={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onCloseAddApiKeyModal={() => {
          setAddConnectionError("");
          setShowAddApiKeyModal(false);
        }}
        showEditModal={showEditModal}
        selectedConnection={selectedConnection}
        onSaveEditConnection={handleUpdateConnection}
        onCloseEditModal={() => setShowEditModal(false)}
        showEditNodeModal={showEditNodeModal}
        onSaveEditNode={handleUpdateNode}
        onCloseEditNodeModal={() => setShowEditNodeModal(false)}
        showAddCustomModel={showAddCustomModel}
        onSaveCustomModel={async (modelId) => {
          const alias = providerInfo?.passthroughModels
            ? modelId.split("/").pop()
            : modelId;
          await handleSetAlias(modelId, alias, providerStorageAlias);
          setShowAddCustomModel(false);
        }}
        onCloseAddCustomModel={() => setShowAddCustomModel(false)}
        showAgRiskModal={showAgRiskModal}
        onCloseAgRiskModal={() => setShowAgRiskModal(false)}
        onAgRiskConfirm={handleAgRiskConfirm}
        confirmState={confirmState}
        onCloseConfirm={() => setConfirmState(null)}
      />
    </div>
  );
}

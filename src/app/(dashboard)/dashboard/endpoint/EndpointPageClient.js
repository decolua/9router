"use client";

import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { CardSkeleton, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { ApiKeyModals } from "./components/ApiKeyModals";
import { ApiKeysCard } from "./components/ApiKeysCard";
import { RemoteAccessCard } from "./components/RemoteAccessCard";
import { RemoteAccessModals } from "./components/RemoteAccessModals";
import { StreamStabilityCard } from "./components/StreamStabilityCard";
import { TokenSaverCard } from "./components/TokenSaverCard";
import { useEndpointApiKeys } from "./hooks/useEndpointApiKeys";
import { useEndpointBaseUrl } from "./hooks/useEndpointBaseUrl";
import { useEndpointRemoteAccess } from "./hooks/useEndpointRemoteAccess";
import { useEndpointSettings } from "./hooks/useEndpointSettings";

export default function APIPageClient({ machineId }) {
  const apiKeys = useEndpointApiKeys();
  const {
    keys,
    loading,
    showAddModal,
    newKeyName,
    createdKey,
    confirmState,
    editingKey,
    editKeyName,
    keyFormError,
    savingKeyId,
    keyActionStatus,
    visibleKeys,
    fetchData,
    setConfirmState,
    setNewKeyName,
    setCreatedKey,
    setEditKeyName,
    openAddKeyModal,
    closeAddKeyModal,
    openEditKeyModal,
    closeEditKeyModal,
    handleSaveKey,
    handleCreateKey,
    handleDeleteKey,
    handleToggleKey,
    maskKey,
    toggleKeyVisibility,
    confirmPauseKey,
  } = apiKeys;

  const {
    requireApiKey,
    requireLogin,
    hasPassword,
    tunnelDashboardAccess,
    rtkEnabled,
    cavemanEnabled,
    cavemanLevel,
    autoRetryOverloaded,
    maxRetryAttempts,
    retryDelayMs,
    midStreamResumeEnabled,
    applySettings,
    handleTunnelDashboardAccess,
    handleRequireApiKey,
    handleRtkEnabled,
    handleAutoRetryOverloaded,
    handleMaxRetryAttempts,
    handleRetryDelayMs,
    handleMidStreamResumeEnabled,
    handleCavemanEnabled,
    handleCavemanLevel,
  } = useEndpointSettings();

  const remoteAccess = useEndpointRemoteAccess({
    requireApiKey,
    requireLogin,
    hasPassword,
    applySettings,
  });
  const tsLogRef = useRef(null);
  const { copied, copy } = useCopyToClipboard();
  const baseUrl = useEndpointBaseUrl();

  useEffect(() => {
    if (tsLogRef.current)
      tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [remoteAccess.tsInstallLog]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchData();
    });
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <RemoteAccessCard
        currentEndpoint={baseUrl}
        copied={copied}
        requireApiKey={requireApiKey}
        tunnelDashboardAccess={tunnelDashboardAccess}
        remoteAccess={remoteAccess}
        onCopy={copy}
        onTunnelDashboardAccessChange={handleTunnelDashboardAccess}
      />

      <TokenSaverCard
        rtkEnabled={rtkEnabled}
        cavemanEnabled={cavemanEnabled}
        cavemanLevel={cavemanLevel}
        onRtkEnabledChange={handleRtkEnabled}
        onCavemanEnabledChange={handleCavemanEnabled}
        onCavemanLevelChange={handleCavemanLevel}
      />

      <StreamStabilityCard
        autoRetryOverloaded={autoRetryOverloaded}
        maxRetryAttempts={maxRetryAttempts}
        retryDelayMs={retryDelayMs}
        midStreamResumeEnabled={midStreamResumeEnabled}
        onAutoRetryOverloadedChange={handleAutoRetryOverloaded}
        onMaxRetryAttemptsChange={handleMaxRetryAttempts}
        onRetryDelayMsChange={handleRetryDelayMs}
        onMidStreamResumeEnabledChange={handleMidStreamResumeEnabled}
      />

      <ApiKeysCard
        keys={keys}
        copied={copied}
        requireApiKey={requireApiKey}
        keyActionStatus={keyActionStatus}
        visibleKeys={visibleKeys}
        savingKeyId={savingKeyId}
        onCreateClick={openAddKeyModal}
        onRequireApiKeyChange={handleRequireApiKey}
        onCopy={copy}
        onToggleVisibility={toggleKeyVisibility}
        onEditKey={openEditKeyModal}
        onPauseKey={confirmPauseKey}
        onToggleKey={handleToggleKey}
        onDeleteKey={handleDeleteKey}
        maskKey={maskKey}
      />

      <ApiKeyModals
        showAddModal={showAddModal}
        newKeyName={newKeyName}
        createdKey={createdKey}
        editingKey={editingKey}
        editKeyName={editKeyName}
        keyFormError={keyFormError}
        savingKeyId={savingKeyId}
        copied={copied}
        onNewKeyNameChange={setNewKeyName}
        onCreatedKeyClose={() => setCreatedKey(null)}
        onEditKeyNameChange={setEditKeyName}
        onCreateKey={handleCreateKey}
        onSaveKey={handleSaveKey}
        onCloseAddModal={closeAddKeyModal}
        onCloseEditModal={closeEditKeyModal}
        onCopy={copy}
      />

      <RemoteAccessModals remoteAccess={remoteAccess} tsLogRef={tsLogRef} />

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};

import {
  ConfirmModal,
  CursorAuthModal,
  EditConnectionModal,
  GitLabAuthModal,
  IFlowCookieModal,
  KiroOAuthWrapper,
  OAuthModal,
} from "@/shared/components";
import AddApiKeyModal from "./AddApiKeyModal";
import AddCustomModelModal from "./AddCustomModelModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";

export default function ProviderDetailModals({
  providerId,
  providerInfo,
  providerNode,
  isCompatible,
  isAnthropicCompatible,
  providerStorageAlias,
  providerDisplayAlias,
  proxyPools,
  showOAuthModal,
  onCloseOAuthModal,
  onOAuthSuccess,
  showIFlowCookieModal,
  onCloseIFlowCookieModal,
  onIFlowCookieSuccess,
  showAddApiKeyModal,
  addConnectionError,
  onSaveApiKey,
  onBulkDone,
  onCloseAddApiKeyModal,
  showEditModal,
  selectedConnection,
  onSaveEditConnection,
  onCloseEditModal,
  showEditNodeModal,
  onSaveEditNode,
  onCloseEditNodeModal,
  showAddCustomModel,
  onSaveCustomModel,
  onCloseAddCustomModel,
  showAgRiskModal,
  onCloseAgRiskModal,
  onAgRiskConfirm,
  confirmState,
  onCloseConfirm,
}) {
  return (
    <>
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={onOAuthSuccess}
          onClose={onCloseOAuthModal}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={onOAuthSuccess}
          onClose={onCloseOAuthModal}
        />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={onOAuthSuccess}
          onClose={onCloseOAuthModal}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={onOAuthSuccess}
          onClose={onCloseOAuthModal}
        />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={showIFlowCookieModal}
          onSuccess={onIFlowCookieSuccess}
          onClose={onCloseIFlowCookieModal}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        error={addConnectionError}
        onSave={onSaveApiKey}
        onBulkDone={onBulkDone}
        onClose={onCloseAddApiKeyModal}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={onSaveEditConnection}
        onClose={onCloseEditModal}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={onSaveEditNode}
          onClose={onCloseEditNodeModal}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={onSaveCustomModel}
          onClose={onCloseAddCustomModel}
        />
      )}

      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={onCloseAgRiskModal}
        onConfirm={onAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={onCloseConfirm}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={
          confirmState?.items?.length ? (
            <span className="flex flex-col gap-3">
              <span>{confirmState.message}</span>
              <span className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-main">
                {confirmState.items.map((item) => (
                  <span key={item} className="block truncate">
                    {item}
                  </span>
                ))}
                {confirmState.moreCount > 0 && (
                  <span className="mt-1 block text-text-muted">
                    +{confirmState.moreCount} more
                  </span>
                )}
              </span>
            </span>
          ) : (
            confirmState?.message
          )
        }
        confirmText={confirmState?.confirmText || "Confirm"}
        variant="danger"
      />
    </>
  );
}

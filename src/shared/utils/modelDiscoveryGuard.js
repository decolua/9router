import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers";

export function isGuardedCustomProvider(providerId) {
  return (
    isOpenAICompatibleProvider(providerId)
    || isAnthropicCompatibleProvider(providerId)
    || isCustomEmbeddingProvider(providerId)
  );
}

export function getModelDiscoveryGuard(providerId) {
  const customProvider = isGuardedCustomProvider(providerId);

  return {
    customProvider,
    autoDiscovery: !customProvider,
    autoCatalog: !customProvider,
    autoProbe: !customProvider,
    autoRoute: !customProvider,
  };
}

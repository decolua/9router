import { getProviderByAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers"

function getInitials(name, fallbackId) {
  if (name && name.trim() !== "") {
    return name.slice(0, 2).toUpperCase()
  }
  return fallbackId.slice(0, 2).toUpperCase()
}

export function resolveProviderIconInfo(providerId, displayName) {
  const entry = getProviderByAlias(providerId)

  if (entry) {
    return {
      fallbackText: entry.textIcon || entry.alias.slice(0, 2).toUpperCase(),
      fallbackColor: entry.color,
    }
  }

  if (isOpenAICompatibleProvider(providerId)) {
    return {
      fallbackText: getInitials(displayName, providerId),
      fallbackColor: "#10A37F",
    }
  }

  if (isAnthropicCompatibleProvider(providerId)) {
    return {
      fallbackText: getInitials(displayName, providerId),
      fallbackColor: "#D97757",
    }
  }

  return {
    fallbackText: getInitials(displayName, providerId),
    fallbackColor: "#6b7280",
  }
}

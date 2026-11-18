"use client";

import { useEffect, useState } from "react";
import { getModelsByProviderId } from "@/shared/constants/models";

export function useProviderModels(providerId) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setCatalog(null);
    setError("");
    if (!["cohere", "pollinations"].includes(providerId)) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/providers", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load provider connections");
        const { connections = [] } = await response.json();
        const connection = connections.find((item) => item.provider === providerId && item.isActive !== false);
        if (!connection && providerId !== "pollinations") return;
        const responseModels = await fetch(`/api/providers/${connection?.id || providerId}/models`, { cache: "no-store" });
        const data = await responseModels.json();
        if (!responseModels.ok || !Array.isArray(data.models)) throw new Error(data.error || "Failed to load model catalog");
        if (!cancelled) setCatalog({ providerId, models: data.models, suggestedModels: data.suggestedModels || [] });
      } catch (error) {
        if (!cancelled) setError(error.message);
      }
    })();
    return () => { cancelled = true; };
  }, [providerId]);
  return { models: catalog?.providerId === providerId ? catalog.models : getModelsByProviderId(providerId), suggestedModels: catalog?.providerId === providerId ? catalog.suggestedModels : [], error };
}

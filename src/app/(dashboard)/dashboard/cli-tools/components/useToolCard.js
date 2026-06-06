"use client";

import { useState, useEffect, useCallback } from "react";

export function useToolCard({ initialStatus, apiKeys, statusEndpoint }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [selectedApiKey, setSelectedApiKey] = useState("");

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch {
      // silently ignore
    }
  }, []);

  const checkStatus = useCallback(async () => {
    if (!statusEndpoint) return;
    setChecking(true);
    try {
      const res = await fetch(statusEndpoint);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, [statusEndpoint]);


  useEffect(() => {
    if (initialStatus) queueMicrotask(() => setStatus(initialStatus));
  }, [initialStatus]);

  return {
    status,
    setStatus,
    checking,
    modelAliases,
    fetchModelAliases,
    checkStatus,
    selectedApiKey,
    setSelectedApiKey,
  };
}

export function getEffectiveBaseUrl(customBaseUrl, baseUrl) {
  const url = customBaseUrl || `${baseUrl}/v1`;
  return url.endsWith("/v1") ? url : `${url}/v1`;
}

export function getDisplayUrl(customBaseUrl, baseUrl) {
  return customBaseUrl || `${baseUrl}/v1`;
}

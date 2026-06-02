export async function fetchProviderDetailPageData(providerId) {
  const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] =
    await Promise.all([
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/provider-nodes", { cache: "no-store" }),
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
    ]);

  return {
    connectionsRes,
    nodesRes,
    proxyPoolsRes,
    settingsRes,
    connectionsData: await connectionsRes.json(),
    nodesData: await nodesRes.json(),
    proxyPoolsData: await proxyPoolsRes.json(),
    settingsData: settingsRes.ok ? await settingsRes.json() : {},
  };
}

export async function fetchProviderNodes() {
  const res = await fetch("/api/provider-nodes", { cache: "no-store" });
  if (!res.ok) return { ok: false, nodes: [] };
  const data = await res.json();
  return { ok: true, nodes: data.nodes || [] };
}

export async function updateProviderNode(providerId, formData) {
  const res = await fetch(`/api/provider-nodes/${providerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });
  const data = await res.json();
  return { res, data };
}

export async function deleteProviderNode(providerId) {
  return fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
}

export async function fetchProviderSettings() {
  const settingsRes = await fetch("/api/settings", { cache: "no-store" });
  return settingsRes.ok ? await settingsRes.json() : {};
}

export async function patchProviderSettings(payload) {
  return fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function createProviderConnection(providerId, formData) {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: providerId, ...formData }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
}

export async function updateProviderConnection(connectionId, formData) {
  return fetch(`/api/providers/${connectionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });
}

export async function deleteProviderConnection(connectionId) {
  return fetch(`/api/providers/${connectionId}`, { method: "DELETE" });
}

export async function testProviderConnection(connectionId) {
  const res = await fetch(`/api/providers/${connectionId}/test`, {
    method: "POST",
  });
  return { res, data: await res.json() };
}

export async function refreshSelectedCodexConnections(connectionIds) {
  const res = await fetch("/api/providers/codex/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionIds }),
  });
  return { res, data: await res.json() };
}

export async function fetchDisabledModelsByProvider(providerStorageAlias) {
  const res = await fetch(
    `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`,
    { cache: "no-store" },
  );
  return { res, data: await res.json() };
}

export async function disableModels(providerStorageAlias, ids) {
  return fetch("/api/models/disabled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
  });
}

export async function enableModel(providerStorageAlias, modelId) {
  return fetch(
    `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`,
    { method: "DELETE" },
  );
}

export async function enableAllModels(providerStorageAlias) {
  return fetch(
    `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`,
    { method: "DELETE" },
  );
}

export async function fetchModelAliases() {
  const res = await fetch("/api/models/alias");
  return { res, data: await res.json() };
}

export async function setModelAlias(model, alias) {
  const res = await fetch("/api/models/alias", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, alias }),
  });
  return { res, data: await res.json() };
}

export async function deleteModelAlias(alias) {
  return fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
    method: "DELETE",
  });
}

export async function testModelReachability(model) {
  const res = await fetch("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return { res, data: await res.json() };
}

export async function fetchKilocodeFreeModels() {
  const res = await fetch("/api/providers/kilo/free-models");
  return res.json();
}

export async function warmupProviderConnection(connectionId, options = {}) {
  const res = await fetch(`/api/providers/${connectionId}/warmup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return { res, data: await res.json() };
}

export async function warmupSelectedConnections(connectionIds, options = {}) {
  const res = await fetch("/api/providers/warmup-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionIds, options }),
  });
  return { res, data: await res.json() };
}


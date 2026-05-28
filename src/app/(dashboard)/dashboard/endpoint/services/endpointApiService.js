export async function fetchSettings() {
  return fetchJson("/api/settings");
}

export async function patchSettings(patch) {
  return fetchJson("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function fetchTunnelStatus() {
  return fetchJson("/api/tunnel/status", { cache: "no-store" });
}

export async function enableTunnel() {
  return fetchJson("/api/tunnel/enable", { method: "POST" });
}

export async function disableTunnel() {
  return fetchJson("/api/tunnel/disable", { method: "POST" });
}

export async function fetchKeys() {
  return fetchJson("/api/keys");
}

export async function createKey(payload) {
  return fetchJson("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateKey(id, payload) {
  return fetchJson(`/api/keys/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteKey(id) {
  return fetchJson(`/api/keys/${id}`, { method: "DELETE" });
}

export async function fetchKeyUsage(id, limit = 20) {
  return fetchJson(`/api/keys/${id}/usage?limit=${limit}`, { cache: "no-store" });
}

export async function checkTailscaleInstalled() {
  return fetchJson("/api/tunnel/tailscale-check");
}

export async function enableTailscale() {
  return fetchJson("/api/tunnel/tailscale-enable", { method: "POST" });
}

export async function disableTailscale() {
  return fetchJson("/api/tunnel/tailscale-disable", { method: "POST" });
}

export function installTailscale(sudoPassword) {
  return fetch("/api/tunnel/tailscale-install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sudoPassword }),
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  return { ok: res.ok, data };
}

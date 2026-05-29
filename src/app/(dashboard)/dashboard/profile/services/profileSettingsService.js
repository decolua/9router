const JSON_HEADERS = { "Content-Type": "application/json" };

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function fetchSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) return null;
  return response.json();
}

export async function patchSettings(payload) {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function testProxyUrl(proxyUrl) {
  const response = await fetch("/api/settings/proxy-test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ proxyUrl }),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function testOidcSettings(payload) {
  const response = await fetch("/api/auth/oidc/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function exportDatabaseBackup({ includeUsageAnalytics }) {
  const params = new URLSearchParams();
  if (includeUsageAnalytics) {
    params.set("includeUsageAnalytics", "true");
  }
  const query = params.toString();
  const response = await fetch(
    `/api/settings/database${query ? `?${query}` : ""}`,
  );
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function importDatabaseBackup(payload) {
  const response = await fetch("/api/settings/database", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

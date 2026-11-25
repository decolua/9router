export function createKeyRequest(fields, allowedConnections) {
  const payload = { ...fields };
  if (allowedConnections.length) payload.allowedConnections = allowedConnections;

  return fetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

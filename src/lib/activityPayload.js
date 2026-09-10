// Keep credential sanitization separate from conversation visibility.
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'token', 'api-key'];
  return Object.fromEntries(Object.entries(headers).filter(([key]) =>
    !sensitiveKeys.some((s) => key.toLowerCase().includes(s))));
}

const credentialKeys = new Set([
  'authorization', 'proxyauthorization', 'apikey', 'xapikey', 'xgoogapikey',
  'cookie', 'setcookie', 'token', 'accesstoken', 'refreshtoken', 'idtoken',
  'password', 'passwd', 'secret', 'clientsecret', 'apisecret', 'privatekey',
  'clisecret', 'jwtsecret', 'credentials',
]);

export function sanitizeActivityPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeActivityPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    // Legacy truncation previews are incomplete JSON and cannot be safely parsed.
    if (key === '_preview' && value._truncated) return [];
    if (credentialKeys.has(normalized)) return [[key, '[REDACTED]']];
    if (typeof entry === 'string' && ['arguments', 'body'].includes(normalized)) {
      try {
        const parsed = JSON.parse(entry);
        const sanitized = sanitizeActivityPayload(parsed);
        return [[key, JSON.stringify(parsed) === JSON.stringify(sanitized) ? entry : JSON.stringify(sanitized)]];
      } catch {
        // Tool arguments are structured JSON, unlike free-text conversation bodies.
        // A partial stream can end inside a credential value; never persist it.
        if (normalized === 'arguments') return [
          [key, '[REDACTED]'],
          ['_capture', { partial: true, notice: 'Incomplete function arguments omitted' }],
        ];
        // Non-JSON conversation bodies are intentionally preserved.
      }
    }
    return [[key, sanitizeActivityPayload(normalized === 'headers' ? sanitizeHeaders(entry) : entry)]];
  }));
}

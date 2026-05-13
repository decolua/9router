const REDACTED_VALUE = "********[REDACTED]********";

const SECRET_KEY_SUBSTRINGS = [
  "apikey",
  "token",
  "secret",
  "password",
  "auth_token",
  "openai_api_key",
  "anthropic_auth_token",
  "inferencegatewayapikey",
];

function isSecretKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_SUBSTRINGS.some((substring) =>
    normalized.includes(substring.replace(/[^a-z0-9]/g, ""))
  );
}

export function maskSecrets(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => maskSecrets(item));
  }

  if (!obj || typeof obj !== "object") {
    return obj;
  }

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      isSecretKey(key) ? REDACTED_VALUE : maskSecrets(value),
    ])
  );
}

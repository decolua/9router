export function parseErrorPayload(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function extractUnsupportedParamFromText(responseText) {
  const data = parseErrorPayload(responseText);
  const err = data?.error || {};
  const msg = String(err.message || data?.message || responseText || "").toLowerCase();
  let param = err.param;

  if (!param) {
    const match = msg.match(/(?:unsupported|unrecognized|unknown).*?(?:parameter|argument).*?['"]?([a-zA-Z0-9_]+)['"]?/i);
    if (match) param = match[1];
  }

  const hasRecognizedUnsupportedParamCode =
    err.code === "unsupported_parameter" ||
    err.code === "unrecognized_request_argument";
  const hasParam = typeof param === "string" && param.length > 0;

  return hasRecognizedUnsupportedParamCode || hasParam ? { param, msg } : null;
}

export async function extractUnsupportedParamFromResponse(response) {
  const responseText = await response.clone().text().catch(() => "");
  return extractUnsupportedParamFromText(responseText);
}

const PAYLOAD_FIELDS = ["request", "providerRequest", "providerResponse", "response"];

export function shouldShowRequestPayloads(env = process.env) {
  return env.SHOW_REQUEST_PAYLOADS?.toLowerCase() === "true";
}

export function prepareRequestDetailsResponse(result, env = process.env) {
  if (shouldShowRequestPayloads(env)) return result;

  const redactedDetails = (result.details || []).map((detail) => {
    const redacted = { ...detail };
    for (const key of PAYLOAD_FIELDS) {
      if (redacted[key] !== undefined) {
        redacted[key] = { redacted: true };
      }
    }
    return redacted;
  });

  return { ...result, details: redactedDetails };
}

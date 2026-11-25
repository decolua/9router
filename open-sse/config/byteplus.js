// BytePlus ModelArk exposes the same model catalog on two API surfaces:
//   standard — pay-as-you-go ModelArk API (free-tier keys)
//   coding   — Coding Plan subscription
// The only difference is the path prefix, so a connection picks a mode and
// both the chat path and the model probe derive their URL from it.
export const BYTEPLUS_ENDPOINTS = {
  standard: "https://ark.ap-southeast.bytepluses.com/api/v3",
  coding: "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
};

export const BYTEPLUS_DEFAULT_ENDPOINT_MODE = "standard";

// First entry of the byteplus registry model list; both endpoints serve it.
export const BYTEPLUS_DEFAULT_MODEL = "seed-2-0-pro-260328";

// Upstream auth failures that mean the key itself is bad even on a non-401 status.
const BYTEPLUS_AUTH_FAILURE_PATTERN =
  /AuthenticationError|InvalidApiKey|invalid api key|incorrect api key|unauthorized/i;

export function resolveByteplusEndpointMode(providerSpecificData) {
  const mode = providerSpecificData?.endpointMode;
  return mode === "coding" || mode === "standard" ? mode : BYTEPLUS_DEFAULT_ENDPOINT_MODE;
}

export function getByteplusBaseUrl(providerSpecificData) {
  return BYTEPLUS_ENDPOINTS[resolveByteplusEndpointMode(providerSpecificData)];
}

export function getByteplusChatUrl(providerSpecificData) {
  return `${getByteplusBaseUrl(providerSpecificData)}/chat/completions`;
}

// Legacy connections carry no `model`; fall back to the caller's registry default.
export function getByteplusModel(providerSpecificData, fallback = null) {
  const model = typeof providerSpecificData?.model === "string" ? providerSpecificData.model.trim() : "";
  return model || fallback;
}

// Plan/model errors (403 AccessDenied, 400 InvalidSubscription, 404 ModelNotOpen)
// keep the key valid; only an auth-shaped body means the key is wrong.
export function isByteplusAuthFailure(bodyText) {
  return BYTEPLUS_AUTH_FAILURE_PATTERN.test(String(bodyText || ""));
}

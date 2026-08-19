import { ROUTE_ATTRIBUTION } from "../config/runtimeConfig.js";

const EXPOSED_HEADERS = Object.values(ROUTE_ATTRIBUTION.headers);

function safeToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._:/-]+/g, "-")
    .slice(0, ROUTE_ATTRIBUTION.maxTokenLength);
}

function splitModel(value) {
  const leaf = safeToken(value);
  const slash = leaf.indexOf("/");
  return slash > 0
    ? { leaf, provider: leaf.slice(0, slash), model: leaf.slice(slash + 1) }
    : { leaf, provider: "", model: leaf };
}

function list(value) {
  return String(value || "")
    .split(",")
    .map(safeToken)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].slice(0, ROUTE_ATTRIBUTION.maxAttempts);
}

function withHeaders(response, values) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(values)) headers.set(name, String(value));
  headers.set(
    "Access-Control-Expose-Headers",
    unique([
      ...list(headers.get("Access-Control-Expose-Headers")),
      ...EXPOSED_HEADERS,
    ]).join(", "),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function annotateDirectResponse({ requestedModel, resolvedModel }, response) {
  const requested = safeToken(requestedModel);
  const resolved = splitModel(resolvedModel || requested);
  return withHeaders(response, {
    [ROUTE_ATTRIBUTION.headers.requestedModel]: requested || resolved.leaf,
    [ROUTE_ATTRIBUTION.headers.routePath]: resolved.leaf,
    [ROUTE_ATTRIBUTION.headers.resolvedProvider]: resolved.provider || "unknown",
    [ROUTE_ATTRIBUTION.headers.resolvedModel]: resolved.model,
    [ROUTE_ATTRIBUTION.headers.fallbackCount]: 0,
    [ROUTE_ATTRIBUTION.headers.attemptedModels]: resolved.leaf,
  });
}

export function annotateComboResponse({ comboName, selectedModel, attemptedModels = [] }, response) {
  if (!(response instanceof Response)) return response;
  const headers = ROUTE_ATTRIBUTION.headers;
  const combo = safeToken(comboName);
  const selected = splitModel(selectedModel);
  const priorPath = list(response.headers.get(headers.routePath));
  const resolvedProvider = safeToken(response.headers.get(headers.resolvedProvider)) || selected.provider || "unknown";
  const resolvedModel = safeToken(response.headers.get(headers.resolvedModel)) || selected.model;
  const currentAttempts = unique(attemptedModels.map(safeToken));
  const priorAttempts = list(response.headers.get(headers.attemptedModels));
  const priorFallbacks = Number.parseInt(response.headers.get(headers.fallbackCount) || "0", 10);
  return withHeaders(response, {
    [headers.requestedModel]: combo,
    [headers.routePath]: unique([combo, ...(priorPath.length ? priorPath : [selected.leaf])]).join(","),
    [headers.resolvedProvider]: resolvedProvider,
    [headers.resolvedModel]: resolvedModel,
    [headers.fallbackCount]: Math.max(0, Number.isFinite(priorFallbacks) ? priorFallbacks : 0) + Math.max(0, currentAttempts.length - 1),
    [headers.attemptedModels]: unique([...currentAttempts, ...priorAttempts]).join(","),
  });
}

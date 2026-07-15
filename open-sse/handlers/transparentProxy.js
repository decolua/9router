import { proxyAwareFetch } from "../utils/proxyFetch.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function copyEndToEndHeaders(headers) {
  const result = new Headers();
  for (const [name, value] of headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) result.set(name, value);
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceModelInStream(body, sourceModel, upstreamModel) {
  if (!body || !sourceModel || sourceModel === upstreamModel) return body;

  const matcher = new RegExp(`("model"\\s*:\\s*)${escapeRegExp(JSON.stringify(sourceModel))}`);
  const replacement = `$1${JSON.stringify(upstreamModel)}`;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const carryLength = JSON.stringify(sourceModel).length + 32;
  let pending = "";
  let replaced = false;

  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      if (!replaced) {
        const next = pending.replace(matcher, replacement);
        if (next !== pending) {
          pending = next;
          replaced = true;
        }
      }
      if (replaced) {
        controller.enqueue(encoder.encode(pending));
        pending = "";
      } else if (pending.length > carryLength) {
        controller.enqueue(encoder.encode(pending.slice(0, -carryLength)));
        pending = pending.slice(-carryLength);
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (!replaced) pending = pending.replace(matcher, replacement);
      if (pending) controller.enqueue(encoder.encode(pending));
    },
  }));
}

export function buildTransparentUpstreamUrl(requestUrl, baseUrl) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(baseUrl);
  const path = incoming.pathname.replace(/^\/api\/v1|^\/v1/, "");
  upstream.pathname = `${upstream.pathname.replace(/\/$/, "")}${path || "/"}`;
  upstream.search = incoming.search;
  return upstream.toString();
}

export function buildTransparentRequestHeaders(requestHeaders, credentials = {}) {
  const headers = copyEndToEndHeaders(requestHeaders);
  if (credentials.apiKey) {
    headers.set("authorization", `Bearer ${credentials.apiKey}`);
    headers.set("x-api-key", credentials.apiKey);
  } else if (credentials.accessToken) {
    headers.set("authorization", `Bearer ${credentials.accessToken}`);
  }
  return headers;
}

export async function handleTransparentAnthropicProxy({ request, credentials, sourceModel, upstreamModel, signal }) {
  const baseUrl = credentials?.providerSpecificData?.baseUrl;
  if (!baseUrl) throw new Error("Transparent Anthropic node is missing a base URL");

  const method = request.method.toUpperCase();
  const options = {
    method,
    headers: buildTransparentRequestHeaders(request.headers, credentials),
    signal: signal || request.signal,
  };
  if (method !== "GET" && method !== "HEAD" && request.body) {
    // The provider prefix is a 9Router routing namespace, not an upstream
    // model identifier. Preserve the stream except for that one field.
    options.body = replaceModelInStream(request.body, sourceModel, upstreamModel);
    options.duplex = "half";
  }

  const response = await proxyAwareFetch(
    buildTransparentUpstreamUrl(request.url, baseUrl),
    options,
    credentials.providerSpecificData
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyEndToEndHeaders(response.headers),
  });
}

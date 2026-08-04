import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import {
  getCodexNativeCatalog,
  getMostRecentCodexClientVersion,
  invalidateCodexNativeCatalog,
  isCodexNativeModel,
} from "./catalog.js";
import { getInstalledCodexClientVersion } from "./clientVersion.js";
import {
  acquireCodexNativeLease,
  failCodexNativeLease,
  ingestCodexNativeQuota,
  incrementCodexNativeHttpFallback,
  markCodexNativeSemanticOutput,
  releaseCodexNativeLease,
  succeedCodexNativeLease,
} from "./pool.js";
import {
  sanitizeCodexNativeRequestHeaders,
  sanitizeCodexNativeResponseHeaders,
} from "./headers.js";
import { codexNativeAuthError, validateCodexNativeClient } from "./clientAuth.js";

const DEFINITIVE_REJECTION = new Set([401, 429]);

function proxyOptions(proxy) {
  return {
    connectionProxyEnabled: proxy.connectionProxyEnabled === true,
    connectionProxyUrl: proxy.connectionProxyUrl || "",
    connectionNoProxy: proxy.connectionNoProxy || "",
    vercelRelayUrl: proxy.vercelRelayUrl || "",
    strictProxy: proxy.strictProxy === true,
  };
}

function errorResponse(status, code, message) {
  return Response.json({
    error: { type: "server_error", code, message },
  }, { status });
}

export function codexClientVersionFromRequest(request) {
  const url = new URL(request.url);
  const queryVersion = url.searchParams.get("client_version");
  if (queryVersion != null) return queryVersion;
  const explicit = request.headers.get("x-codex-client-version");
  if (explicit) return explicit;
  const userAgent = request.headers.get("user-agent") || "";
  const match = userAgent.match(/\bcodex(?:_cli_rs)?\/([^\s]+)/i);
  return match?.[1] || null;
}

async function resolveCodexClientVersion(request) {
  const requestVersion = codexClientVersionFromRequest(request);
  if (requestVersion) return requestVersion;
  const installed = await getInstalledCodexClientVersion();
  return installed.version || await getMostRecentCodexClientVersion();
}

export function isCodexSemanticEvent(event) {
  const type = typeof event === "string" ? event : event?.type;
  if (!type) return false;
  return type.startsWith("response.output_")
    || type.includes("output_text")
    || type.includes("reasoning")
    || type.includes("function_call")
    || type.includes("tool_call")
    || type.includes("image_generation")
    || type === "response.completed";
}

function inspectSseText(text, leaseId, connectionId) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const event = JSON.parse(raw);
      if (event.type === "codex.rate_limits") {
        ingestCodexNativeQuota(connectionId, event, "sse");
      }
      if (isCodexSemanticEvent(event)) markCodexNativeSemanticOutput(leaseId);
    } catch {
      // Partial SSE records are inspected again after the next chunk.
    }
  }
}

function monitoredBody(upstream, lease) {
  if (!upstream.body) return null;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (pending) inspectSseText(pending, lease.id, lease.connectionId);
          await succeedCodexNativeLease(lease.id, { headers: upstream.headers });
          releaseCodexNativeLease(lease.id);
          controller.close();
          return;
        }
        const text = pending + decoder.decode(value, { stream: true });
        const boundary = text.lastIndexOf("\n\n");
        if (boundary >= 0) {
          inspectSseText(text.slice(0, boundary + 2), lease.id, lease.connectionId);
          pending = text.slice(boundary + 2);
        } else {
          pending = text.slice(-16_384);
        }
        controller.enqueue(value);
      } catch (error) {
        await failCodexNativeLease(lease.id, { status: 502, error: error.message });
        releaseCodexNativeLease(lease.id);
        controller.error(error);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
      releaseCodexNativeLease(lease.id);
    },
  });
}

function shouldRetryStatus(status, operation) {
  if (DEFINITIVE_REJECTION.has(status)) return true;
  return operation === "responses" && status >= 500;
}

function upstreamUrl(path) {
  return `${CODEX_NATIVE_CONFIG.upstreamHttpBaseUrl}/${path}`;
}

async function parseRoutingCopy(rawBody, contentType) {
  if (!rawBody.byteLength || !String(contentType || "").toLowerCase().includes("json")) return {};
  try {
    return JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return null;
  }
}

export async function relayCodexNativeHttp(request, {
  path,
  operation,
  validateModel = false,
  allowTransportReplay = false,
} = {}) {
  const auth = await validateCodexNativeClient(request);
  if (!auth.ok) return codexNativeAuthError(auth);
  if (operation === "responses") incrementCodexNativeHttpFallback();

  const rawBody = await request.arrayBuffer();
  const routingBody = await parseRoutingCopy(rawBody, request.headers.get("content-type"));
  if (routingBody === null) return errorResponse(400, "invalid_json", "Invalid JSON body");
  const model = typeof routingBody?.model === "string" ? routingBody.model.trim() : null;
  const clientVersion = await resolveCodexClientVersion(request);

  if (validateModel) {
    if (!model || model.includes("/")) {
      return errorResponse(400, "model_not_in_codex_native_catalog", "A bare native Codex model slug is required");
    }
    let catalog;
    try {
      catalog = await getCodexNativeCatalog({ clientVersion });
    } catch (error) {
      return errorResponse(503, "codex_catalog_unavailable", error.message);
    }
    if (!isCodexNativeModel(catalog, model)) {
      return errorResponse(
        400,
        "model_not_in_codex_native_catalog",
        `Model '${model}' is not available in the selected native metadata cohort`
      );
    }
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  while (true) {
    const routed = await acquireCodexNativeLease({
      headers: Object.fromEntries(request.headers.entries()),
      body: routingBody || {},
      model,
      transport: "http",
      clientVersion,
      excludeConnectionIds,
    });
    const lease = routed.lease;
    if (!lease) {
      return errorResponse(
        503,
        "codex_native_accounts_unavailable",
        lastError || "No eligible Codex account is available for this model"
      );
    }

    const headers = sanitizeCodexNativeRequestHeaders(request.headers, lease.credentials);
    let upstream;
    try {
      upstream = await proxyAwareFetch(upstreamUrl(path), {
        method: request.method,
        headers,
        body: rawBody.byteLength ? rawBody.slice(0) : undefined,
        signal: request.signal,
      }, proxyOptions(lease.proxy));
    } catch (error) {
      await failCodexNativeLease(lease.id, { status: 502, error: error.message });
      releaseCodexNativeLease(lease.id);
      excludeConnectionIds.add(lease.connectionId);
      lastError = error.message;
      if (allowTransportReplay) continue;
      return errorResponse(502, "codex_upstream_transport_error", error.message);
    }

    ingestCodexNativeQuota(lease.connectionId, upstream.headers, "headers");
    const modelsEtag = upstream.headers.get("x-models-etag");
    if (modelsEtag) {
      invalidateCodexNativeCatalog(lease.connectionId, modelsEtag, clientVersion);
    }

    if (!upstream.ok && shouldRetryStatus(upstream.status, operation)) {
      const bodyBytes = new Uint8Array(await upstream.arrayBuffer());
      const detail = new TextDecoder().decode(bodyBytes).slice(0, 512);
      await failCodexNativeLease(lease.id, { status: upstream.status, error: detail });
      releaseCodexNativeLease(lease.id);
      excludeConnectionIds.add(lease.connectionId);
      lastError = detail || `Codex upstream returned ${upstream.status}`;
      continue;
    }

    const responseHeaders = sanitizeCodexNativeResponseHeaders(upstream.headers);
    if (!upstream.ok) {
      const bodyBytes = await upstream.arrayBuffer();
      await failCodexNativeLease(lease.id, {
        status: upstream.status,
        error: new TextDecoder().decode(bodyBytes).slice(0, 512),
      });
      releaseCodexNativeLease(lease.id);
      return new Response(bodyBytes, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    if (!upstream.body) {
      await succeedCodexNativeLease(lease.id, { headers: upstream.headers });
      releaseCodexNativeLease(lease.id);
      return new Response(null, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }
    return new Response(monitoredBody(upstream, lease), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }
}

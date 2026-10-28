// App-side root owner for proxy handlers.
//
// The handlers are the only place that knows a request was admitted (parsed,
// authenticated, locally validated). Nested combo/fallback invocations run
// inside the same AsyncLocalStorage root and never call this helper, so only
// the root can finalize one `request.failed` for the whole proxy call.
//
// No DB, no engine imports, no body parsing. Failure classification reads only
// explicit metadata attached by the handler branch that created the Response.
// A non-2xx body is never cloned, read or awaited; binary 2xx bodies are wrapped
// lazily so transport errors are observed from the consumer's own reads.

import {
  captureWebhookFinalizer,
  hasWebhookSink,
  markWebhookAdmitted,
  runWithWebhookContext,
} from "./events.js";

const ERROR_CLASSES = new Set([
  "upstream_http", "upstream_network", "upstream_timeout", "no_credentials",
  "all_unavailable", "stream_failed", "refresh_failed", "internal",
]);
const BINARY_TYPES = new Set(["application/octet-stream", "application/pdf", "application/zip"]);
const failureMetadata = new WeakMap();

export function markWebhookFailure(response, errorClass) {
  if (response && typeof response === "object") {
    failureMetadata.set(response, ERROR_CLASSES.has(errorClass) ? errorClass : "upstream_http");
  }
  return response;
}

function statusCodeOf(response) {
  const status = response?.status;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function classifyFailureResponse(response, request) {
  const statusCode = statusCodeOf(response);
  if (statusCode === 499 || request?.signal?.aborted) {
    return { outcome: "client_cancelled" };
  }

  let errorClass = failureMetadata.get(response);
  if (!errorClass) {
    errorClass = response?.headers?.get("retry-after") ? "all_unavailable" : "upstream_http";
  }

  return { outcome: "failed", statusCode, errorClass };
}

function isBinaryResponse(response) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") return false;
  const mediaType = (response.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mediaType || mediaType === "text/event-stream" || mediaType === "application/json"
    || mediaType.endsWith("+json")) return false;
  return mediaType.startsWith("audio/") || mediaType.startsWith("image/")
    || mediaType.startsWith("video/") || BINARY_TYPES.has(mediaType);
}

function binaryFailure(error, request, statusCode, bytes) {
  if (request?.signal?.aborted) return { outcome: "client_cancelled" };
  return {
    outcome: "failed",
    statusCode,
    errorClass: error?.name === "TimeoutError" ? "upstream_timeout" : "stream_failed",
    partialResponse: bytes > 0,
  };
}

function observeBinaryResponse(response, finalize, request) {
  const reader = response.body.getReader();
  const statusCode = statusCodeOf(response);
  let settled = false;
  let bytes = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (settled) return;
        if (next.done) {
          settled = true;
          controller.close();
          return;
        }
        bytes += next.value?.byteLength || 0;
        controller.enqueue(next.value);
      } catch (error) {
        if (settled) return;
        settled = true;
        finalize(binaryFailure(error, request, statusCode, bytes));
        controller.error(error);
      }
    },
    cancel(reason) {
      if (settled) return undefined;
      settled = true;
      finalize({ outcome: "client_cancelled" });
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function classifyThrown(error, request) {
  if (request?.signal?.aborted) return { outcome: "client_cancelled" };
  if (error?.name === "TimeoutError") return { outcome: "failed", errorClass: "upstream_timeout" };
  return { outcome: "failed", errorClass: "upstream_network" };
}

/**
 * Run a proxy handler as the webhook root for this request.
 *
 * `handler` receives `{ admit, finalize }`:
 *   - call `admit()` after parse + auth + local validation/key access;
 *   - pass `finalize` to source observers (stream terminal, binary reader) so
 *     they own the final event instead of response status inference.
 *
 * The helper classifies a non-2xx returned Response as the terminal failure.
 * A 2xx response is deliberately NOT finalized: headers are not stream success.
 */
export function withWebhookRoot(request, modality, handler) {
  return runWithWebhookContext({ modality }, async () => {
    const rawFinalize = captureWebhookFinalizer();
    const finalize = (outcome = {}) => rawFinalize({
      ...outcome,
      modality: outcome.modality || modality,
    });
    const webhook = {
      admit: () => markWebhookAdmitted(),
      finalize,
    };

    try {
      const response = await handler(webhook);
      const statusCode = statusCodeOf(response);
      if (statusCode !== undefined && statusCode >= 400) {
        finalize(classifyFailureResponse(response, request));
        return response;
      }
      if (statusCode !== undefined && statusCode >= 200 && statusCode < 300
        && hasWebhookSink() && isBinaryResponse(response)) {
        return observeBinaryResponse(response, finalize, request);
      }
      return response;
    } catch (error) {
      finalize(classifyThrown(error, request));
      throw error;
    }
  });
}

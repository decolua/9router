import { bindInference, currentInference, startInference } from "./requestContext.js";
import { readRequestKey } from "../../sse/services/requestKey.js";
import { classifyInferenceError } from "open-sse/services/inferenceError.js";
import { saveRequestUsage } from "../db/repos/usageRepo.js";

// Preserve SSE bytes and backpressure. A transport can close without a usage callback.
function trackStream(body, finish) {
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { await finish(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) { await finish(error); controller.error(error); }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { await finish(new Error("Client disconnected")); }
    },
  }, { highWaterMark: 0 });
}

// The outermost handler owns the response, including format conversion and early errors.
export function inferenceRoute(handler) {
  return async function correlated(request, ...args) {
    if (currentInference()) return handler(request, ...args);
    return startInference(request, async trace => {
      let response;
      try {
        await readRequestKey(request);
        response = await handler(request, ...args);
      } catch (error) {
        trace.failure = classifyInferenceError({ status: 500, error });
        console.error(`[inference] ${trace.requestId} ${trace.failure.category}`);
        response = Response.json({ error: "Inference request failed" }, { status: 500 });
      }
      if (!response) return response; // Budget handler declined ownership.
      if (!response.ok) trace.failure ??= classifyInferenceError({ status: response.status });

      const finish = bindInference(async error => {
        if (trace.usageStarted) return;
        if (error) trace.failure ??= classifyInferenceError({ error });
        await saveRequestUsage({ status: trace.failure ? "error" : "ok", provider: trace.provider,
          model: trace.model, connectionId: trace.connectionId, apiKey: trace.apiKey, endpoint: new URL(request.url).pathname });
      });
      const headers = new Headers(response.headers);
      headers.set("X-Request-Id", trace.requestId);
      let body = response.body;
      if (body && response.ok && headers.get("content-type")?.includes("text/event-stream")) {
        body = trackStream(body, finish);
      } else {
        await finish();
      }
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    });
  };
}

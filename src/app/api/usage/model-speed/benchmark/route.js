import { getProviderConnections } from "@/models";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { getApiKeys } from "@/lib/localDb";

const BENCHMARK_PROMPT = "Reply with exactly words: ok, hello word";
const BENCHMARK_MAX_TOKENS = 30;

function sseEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build a mock Request object that handleChat expects.
 */
function createMockChatRequest(provider, modelId, activeApiKey) {
  const fullModelId = `${provider}/${modelId}`;
  const body = {
    model: fullModelId,
    stream: false,
    max_tokens: BENCHMARK_MAX_TOKENS,
    messages: [{ role: "user", content: BENCHMARK_PROMPT }],
    _benchmark: true // Optional flag if we want downstream to know
  };

  const headers = {
    "Content-Type": "application/json",
    // Add a special user-agent or header if we want to identify benchmark calls
    "User-Agent": "9Router-Benchmark/1.0",
  };

  if (activeApiKey) {
    headers["Authorization"] = `Bearer ${activeApiKey}`;
  }

  return new Request("http://localhost/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Execute a single benchmark call using the internal router.
 * Returns { totalMs, error } (tokens/speed are logged automatically by the router).
 */
async function runRouterBenchmarkCall(provider, modelId, activeApiKey) {
  const start = Date.now();
  try {
    const mockReq = createMockChatRequest(provider, modelId, activeApiKey);
    
    // Pass forceSourceFormat = "openai" so translator knows it's an OpenAI style request
    const response = await handleChat(mockReq, null, "openai");

    if (!response.ok) {
      const errText = await response.text();
      return { error: `HTTP ${response.status}: ${errText}` };
    }

    // Response is JSON because we set stream: false
    const data = await response.json();
    const totalMs = Date.now() - start;

    return {
      totalMs,
      // We pass these back just for the UI progress event, though they're already
      // saved to DB automatically by the router.
      completionTokens: data.usage?.completion_tokens ?? 0,
      promptTokens: data.usage?.prompt_tokens ?? 0,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * POST /api/usage/model-speed/benchmark
 * Streams SSE events for each model tested. Actual request saving is handled by
 * normal chat routing logic.
 */
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch {
          // stream may have closed
        }
      };

      try {
        const allConnections = await getProviderConnections({ isActive: true });

        // Build a flat list of (provider, modelId) pairs to benchmark
        const tasks = [];
        const seenCombinations = new Set();

        for (const conn of allConnections) {
          const models = getModelsByProviderId(conn.provider);
          if (!models || models.length === 0) continue;

          for (const m of models) {
            if (m.type && m.type !== "chat") continue;

            const comboKey = `${conn.provider}/${m.id}`;
            // We only need to test each provider/model combination once,
            // even if they have multiple connections for the same provider.
            // handleChat will automatically pick an available connection.
            if (!seenCombinations.has(comboKey)) {
              seenCombinations.add(comboKey);
              tasks.push({ provider: conn.provider, modelId: m.id });
            }
          }
        }

        send({ type: "start", total: tasks.length });

        // Get an active local API key to bypass requireApiKey, if any exist
        const apiKeys = await getApiKeys();
        const activeApiKey = apiKeys.find((k) => k.isActive !== false)?.key;

        let succeeded = 0;
        let failed = 0;

        // Run tests sequentially to avoid completely saturating rate limits
        for (const { provider, modelId } of tasks) {
          send({
            type: "progress",
            provider,
            model: modelId,
            status: "running",
          });

          const result = await runRouterBenchmarkCall(provider, modelId, activeApiKey);

          if (result.error) {
            failed++;
            send({
              type: "progress",
              provider,
              model: modelId,
              status: "error",
              error: result.error,
            });
          } else {
            succeeded++;
            const { totalMs, completionTokens } = result;
            const speed =
              totalMs > 0 && completionTokens > 0
                ? completionTokens / (totalMs / 1000)
                : 0;

            send({
              type: "progress",
              provider,
              model: modelId,
              status: "done",
              speedTokPerSec: parseFloat(speed.toFixed(2)),
              latencyMs: totalMs,
              completionTokens,
            });
          }
        }

        send({
          type: "done",
          total: tasks.length,
          succeeded,
          failed,
        });
      } catch (err) {
        send({ type: "error", error: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

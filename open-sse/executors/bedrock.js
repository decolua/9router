import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { signRequest } from "../utils/awsSigv4.js";
import { drainFrames } from "../utils/awsEventStream.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_HEADERS } from "../utils/sseConstants.js";
import { dbg } from "../utils/debugLog.js";

const ANTHROPIC_BEDROCK_VERSION = "bedrock-2023-05-31";
const DEFAULT_REGION = "us-east-1";

// Bedrock rejects the modelId in the body and takes it in the path instead.
// These are the Anthropic-Messages fields Bedrock does not accept.
const BODY_STRIP = ["model", "stream", "anthropic_beta"];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Path-injection guard: modelId lands in the URL path, and the signer trusts
// that the pathname it signs is the pathname fetch sends. A "/" or "?" here
// would sign one path and request another.
function assertModelId(modelId) {
  if (!modelId || typeof modelId !== "string" || /[/?#\s]/.test(modelId)) {
    throw new Error(`Bedrock: invalid model id "${modelId}"`);
  }
  return modelId;
}

function credentialsFor(credentials) {
  const psd = credentials?.providerSpecificData || {};
  // Secret key rides in the standard apiKey field; access key id is per-connection
  // data. Mirrors what aws-polly's registry notice already documents.
  const secretAccessKey = credentials?.apiKey || psd.secretAccessKey;
  const accessKeyId = psd.accessKeyId;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Bedrock requires an AWS access key ID and secret access key. " +
      "Set the secret as the API key and accessKeyId in the connection's provider settings."
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: psd.sessionToken || null,
    region: (psd.region || DEFAULT_REGION).trim(),
  };
}

/**
 * Convert one Bedrock EventStream event into the Claude SSE bytes the rest of
 * the pipeline already understands.
 *
 * Bedrock re-frames Anthropic's Messages SSE as binary EventStream: each `chunk`
 * event carries base64 `bytes` holding one Claude event JSON. Exceptions arrive
 * as their own event types with a `:exception-type` header.
 */
export function eventToSSE(event) {
  const headers = event?.headers || {};
  const messageType = headers[":message-type"];
  const eventType = headers[":event-type"];

  if (messageType === "exception" || messageType === "error") {
    const kind = headers[":exception-type"] || headers[":error-code"] || "bedrockException";
    const message = event?.payload?.message || event?.payload?.Message
      || headers[":error-message"] || "Bedrock stream error";
    return { error: `${kind}: ${message}` };
  }

  if (eventType !== "chunk") return null;

  const raw = event?.payload?.bytes;
  if (!raw) return null;
  // Node's atob-free path: payload.bytes is base64 in the JSON payload.
  const json = typeof raw === "string"
    ? Buffer.from(raw, "base64").toString("utf8")
    : decoder.decode(raw);

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  // Bedrock-only extension on the final event: fold it into Claude's usage shape
  // so usageTracking.extractUsage sees the real token counts.
  const metrics = parsed["amazon-bedrock-invocationMetrics"];
  if (metrics) {
    if (parsed.type === "message_delta") {
      parsed.usage = {
        ...(parsed.usage || {}),
        input_tokens: metrics.inputTokenCount ?? parsed.usage?.input_tokens ?? 0,
        output_tokens: metrics.outputTokenCount ?? parsed.usage?.output_tokens ?? 0,
        ...(metrics.cacheReadInputTokenCount != null
          ? { cache_read_input_tokens: metrics.cacheReadInputTokenCount } : {}),
        ...(metrics.cacheWriteInputTokenCount != null
          ? { cache_creation_input_tokens: metrics.cacheWriteInputTokenCount } : {}),
      };
    }
    delete parsed["amazon-bedrock-invocationMetrics"];
  }

  // Claude SSE is event-named; stream.js keys off `data:` but downstream
  // passthrough clients expect the event line, exactly as api.anthropic.com sends it.
  return { sse: `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n` };
}

/**
 * BedrockExecutor — Anthropic Claude models on Amazon Bedrock.
 *
 * Auth: AWS SigV4 with long-lived access keys (optionally an STS session token).
 * Wire: POST /model/{modelId}/invoke-with-response-stream, whose response is
 * AWS binary EventStream wrapping Claude Messages events. Non-streaming uses
 * /invoke and returns plain Claude JSON.
 *
 * The registry declares format:"claude", so the existing Claude translators do
 * all body/response work; this executor only handles transport + framing.
 */
export class BedrockExecutor extends BaseExecutor {
  constructor() {
    super("bedrock", PROVIDERS.bedrock || {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const { region } = credentialsFor(credentials);
    const action = stream ? "invoke-with-response-stream" : "invoke";
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${assertModelId(model)}/${action}`;
  }

  transformRequest(model, body, stream) {
    const out = { ...body, anthropic_version: ANTHROPIC_BEDROCK_VERSION };
    for (const key of BODY_STRIP) delete out[key];
    return out;
  }

  buildHeaders() {
    // Real headers are produced in execute(), where the signature covers the body.
    return { "Content-Type": "application/json" };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const aws = credentialsFor(credentials);
    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(model, body, stream);
    const bodyStr = JSON.stringify(transformedBody);

    const headers = signRequest({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: stream ? "application/vnd.amazon.eventstream" : "application/json",
      },
      body: bodyStr,
      region: aws.region,
      service: "bedrock",
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey,
      sessionToken: aws.sessionToken,
    });

    dbg("FETCH", `BEDROCK → ${url} | body=${bodyStr.length}B | region=${aws.region}`);
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal,
    }, proxyOptions);

    if (!response.ok || !stream) {
      return { response, url, headers, transformedBody };
    }

    return {
      response: new Response(this.decodeEventStream(response, log), {
        status: response.status,
        statusText: response.statusText,
        headers: { ...SSE_HEADERS },
      }),
      url,
      headers,
      transformedBody,
    };
  }

  /** Binary EventStream → Claude SSE. */
  decodeEventStream(response, log) {
    const upstream = response.body;
    let buffer = new Uint8Array(0);

    return new ReadableStream({
      async start(controller) {
        const reader = upstream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            const joined = new Uint8Array(buffer.byteLength + value.byteLength);
            joined.set(buffer);
            joined.set(value, buffer.byteLength);

            const { events, rest } = drainFrames(joined);
            // slice(): keep the carry-over off the (much larger) joined buffer.
            buffer = rest.slice();

            for (const event of events) {
              const out = eventToSSE(event);
              if (!out) continue;
              if (out.error) {
                log?.debug?.("BEDROCK", out.error);
                controller.enqueue(encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: out.error } })}\n\n`
                ));
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(out.sse));
            }
          }
          if (buffer.byteLength) {
            log?.debug?.("BEDROCK", `discarding ${buffer.byteLength}B partial trailing frame`);
          }
          controller.close();
        } catch (error) {
          if (error.name === "AbortError") {
            controller.error(error);
            return;
          }
          controller.enqueue(encoder.encode(
            `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: error.message } })}\n\n`
          ));
          controller.close();
        } finally {
          reader.releaseLock?.();
        }
      },
      cancel(reason) {
        upstream.cancel?.(reason);
      },
    });
  }
}

export default BedrockExecutor;

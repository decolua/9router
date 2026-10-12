import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { AWS_EVENTSTREAM, AWS_SIGV4, BEDROCK } from "../config/awsConstants.js";
import {
  resolveAwsCredentials,
  resolveRegion,
} from "../shared/awsCredentials.js";
import { crc32, parseEventFrame } from "../utils/awsEventStream.js";
import { escapeUri, signAwsRequest } from "../utils/awsSigv4.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { FORMATS } from "../translator/formats.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

/**
 * BedrockExecutor — Amazon Bedrock runtime.
 *
 * Auth: SigV4, signed per request from credentials resolved by shared/awsCredentials.js.
 * That is what gives this provider real AWS SSO support: a connection can name a local AWS
 * profile instead of carrying keys, and each request re-resolves through the AWS SDK, so an
 * `aws sso login` session is picked up and refreshed without touching the connection.
 *
 * Wire format: Anthropic Messages, so `transport.format` is "claude" and the existing claude
 * translators are reused. Streaming responses arrive as AWS EventStream frames whose payloads
 * are base64 Anthropic events, so they are unwrapped back into Claude SSE here rather than in
 * a translator — the same reason kiro decodes its own framing.
 */
export class BedrockExecutor extends BaseExecutor {
  constructor(providerId = "bedrock") {
    super(providerId, PROVIDERS[providerId] || {});
    // One executor serves both Bedrock entries, the way VertexExecutor serves vertex and
    // vertex-partner. The registry transport format decides the wire shape: "claude" for the
    // Anthropic models, "openai" for xAI's Grok, which speaks Chat Completions on Bedrock.
    this.wireFormat = this.config?.format || FORMATS.OPENAI;
    this.isClaudeWire = this.wireFormat === FORMATS.CLAUDE;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // resolveRegion validates the value; it lands in the hostname, so an unvalidated region
    // would let a connection redirect signed traffic to an arbitrary origin.
    const region = resolveRegion(credentials);

    // Fail here rather than mid-stream: a non-Anthropic Bedrock model returns chunks this
    // executor cannot read, and discovering that after the upstream call has been billed is a
    // worse experience than an upfront message naming the limitation.
    const familyPattern = BEDROCK.modelFamilyPatterns[this.wireFormat];
    if (familyPattern && !familyPattern.test(String(model || ""))) {
      throw new Error(
        `Bedrock model ${JSON.stringify(model)} is not supported by the ${this.provider} ` +
          `provider, which expects ${BEDROCK.modelFamilyHints[this.wireFormat]}. Model families ` +
          "on Bedrock use different request and response shapes, so each gets its own provider " +
          "entry rather than failing mid-stream after the call is billed.",
      );
    }

    const action = stream ? BEDROCK.streamPath : BEDROCK.invokePath;
    // The model id must be escaped once here; awsSigv4 escapes it a second time for the
    // canonical request, which is what Bedrock expects for a ":0"-suffixed version.
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${escapeUri(model)}/${action}`;
  }

  /**
   * Bedrock takes the Anthropic body but rejects `model` and `stream` (the model lives in the
   * URL, and streaming is chosen by the endpoint), and requires `anthropic_version` instead.
   */
  transformRequest(model, body, stream, credentials) {
    const { model: _model, stream: _stream, ...rest } = body || {};
    // Both wires drop `model` and `stream`: Bedrock takes the model from the URL and picks
    // streaming by endpoint. Only the Anthropic wire wants a version pin, and it goes AFTER the
    // spread because a claude-format client may carry its own (e.g. "2023-06-01"), and letting
    // that win earns a ValidationException.
    if (!this.isClaudeWire) return rest;
    return { ...rest, anthropic_version: BEDROCK.anthropicVersion };
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      Accept: stream
        ? "application/vnd.amazon.eventstream"
        : "application/json",
    };
  }

  // Deliberately NO refreshCredentials override. chatCore gates the refresh-and-retry path on
  // `newCredentials?.accessToken || newCredentials?.copilotToken` (handlers/chatCore.js:420), and
  // SigV4 has no bearer token to put there, so any value this returned would be dead code — an
  // earlier version returned { expiresAt } and silently never took effect. Inheriting the base
  // `null` is the honest answer. Refresh still happens, just a layer down: execute() calls
  // resolveAwsCredentials on every request and that re-resolves past expiry, so an expired SSO
  // session recovers on the next request. The cost is that a 401/403 is not transparently
  // retried within the same request.

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }) {
    const resolved = await resolveAwsCredentials(credentials, { log });

    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(
      model,
      body,
      stream,
      credentials,
    );
    const payload = JSON.stringify(transformedBody);

    // Content-Length is deliberately not signed: fetch sets it itself, and signing a value the
    // runtime may normalise differently is a needless SignatureDoesNotMatch risk.
    const headers = signAwsRequest({
      method: "POST",
      url,
      headers: this.buildHeaders(credentials, stream),
      body: payload,
      region: resolved.region,
      service: BEDROCK.service,
      credentials: resolved,
    });

    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(
      () => connectCtrl.abort(new Error("Bedrock fetch connect timeout")),
      this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS,
    );
    const fetchSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;
    let response;
    try {
      response = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: payload,
          signal: fetchSignal,
          // Bedrock never redirects. Following one would replay the body and the signed
          // x-amz-security-token at whatever origin the redirect names, so refuse instead.
          redirect: "error",
        },
        proxyOptions,
      );
    } catch (error) {
      if (connectCtrl.signal.aborted && !signal?.aborted) {
        throw new Error("Bedrock fetch connect timeout", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(connectTimer);
    }

    // The returned headers only feed chatCore's request logger, which writes them to disk
    // unmasked. The session token is a credential and the signature can replay this request,
    // so both are redacted there; the key id and signed-header list stay for debugging.
    const loggedHeaders = redactSignedHeaders(headers);

    // Errors and non-streaming calls are already JSON the claude translator understands.
    if (!response.ok || !stream || !response.body) {
      return { response, url, headers: loggedHeaders, transformedBody };
    }

    return {
      response: new Response(this.eventStreamToSse(response.body, log), {
        status: response.status,
        statusText: response.statusText,
        headers: { ...SSE_HEADERS },
      }),
      url,
      headers: loggedHeaders,
      transformedBody,
    };
  }

  /**
   * Unwrap AWS EventStream framing into SSE in this provider's wire format:
   * named Claude events, or bare OpenAI `data:` chunks terminated by [DONE].
   *
   * Each `chunk` frame carries {"bytes": "<base64>"} whose contents are one Anthropic
   * streaming event, so the transform is: decode frame → base64-decode → re-emit as
   * `event: <type>` / `data: <json>`.
   *
   * Termination runs through exactly one path. An earlier version closed the controller inside
   * the drain loop and again in `finally`, which left the upstream reader locked and never
   * cancelled, leaking the connection on every throttle or framing error.
   *
   * @param {ReadableStream<Uint8Array>} upstream
   * @returns {ReadableStream<Uint8Array>}
   */
  eventStreamToSse(upstream, log = null) {
    const reader = upstream.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = new Uint8Array(0);
    // Anthropic ends a well-formed stream with message_stop. Without tracking it, an upstream
    // that closes cleanly mid-answer looks like a complete response to the client.
    let sawTerminalEvent = false;
    // A client that disconnects mid-answer legitimately never reaches message_stop, so the
    // truncation check must not fire for it: that logged a false error and, worse, enqueued
    // onto an already-cancelled controller, which throws past the teardown below.
    let downstreamCancelled = false;
    let failed = false;

    return new ReadableStream({
      start: async (controller) => {
        const emit = (eventType, data) => {
          // Enqueueing onto a cancelled controller throws; the client is gone, so drop it.
          if (downstreamCancelled) return;
          // Claude SSE names each event; OpenAI SSE is bare `data:` lines, so an `event:` line
          // there would be junk the OpenAI parsers have to skip.
          const frame = this.isClaudeWire
            ? `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
            : `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };

        /** Record a protocol failure as a Claude error event. Returns false to stop draining. */
        const fail = (type, message) => {
          if (failed) return false;
          failed = true;
          log?.error?.("BEDROCK", `${type}: ${message}`);
          emit(
            "error",
            this.isClaudeWire
              ? { type: "error", error: { type, message } }
              : { error: { type, message, code: type } },
          );
          return false;
        };

        const drainFrames = () => {
          while (buffer.byteLength >= 12) {
            // The byteLength argument is load-bearing: without it the view runs to the end of
            // undici's pooled ArrayBuffer, not the end of this chunk, so any read added beyond
            // the >= 12 guard below would silently parse neighbouring pooled bytes.
            const view = new DataView(
              buffer.buffer,
              buffer.byteOffset,
              buffer.byteLength,
            );
            if (view.getUint32(8, false) !== crc32(buffer.subarray(0, 8))) {
              return fail(
                "api_error",
                "Bedrock EventStream prelude CRC mismatch",
              );
            }
            const totalLength = view.getUint32(0, false);
            const headersLength = view.getUint32(4, false);
            if (
              totalLength < 16 ||
              totalLength > AWS_EVENTSTREAM.maxMessageBytes ||
              headersLength > AWS_EVENTSTREAM.maxHeadersBytes ||
              headersLength > totalLength - 16
            ) {
              return fail(
                "api_error",
                "Bedrock EventStream frame bounds are invalid",
              );
            }
            // Frame not fully arrived yet; wait for more bytes.
            if (buffer.byteLength < totalLength) break;

            const frame = buffer.slice(0, totalLength);
            buffer = buffer.slice(totalLength);

            let event;
            try {
              event = parseEventFrame(frame);
            } catch (error) {
              return fail("api_error", error.message);
            }

            const messageType = event.headers[":message-type"];
            // Bedrock reports throttling and validation failures as in-band frames, not HTTP
            // status codes, so these must surface instead of looking like a clean end of stream.
            if (messageType === "exception" || messageType === "error") {
              const exceptionType =
                event.headers[":exception-type"] ||
                event.headers[":error-code"] ||
                "api_error";
              const message =
                event.payload?.message ||
                event.payload?.Message ||
                event.headers[":error-message"] ||
                `Bedrock returned an EventStream ${messageType}`;
              return fail(exceptionType, message);
            }

            // InvokeModelWithResponseStream defines no other event type today, so an unknown one
            // means AWS extended the protocol. Failing would break every stream over what may be
            // a harmless metadata event; skipping silently could hide lost content. Say so.
            if (event.headers[":event-type"] !== BEDROCK.chunkEventName) {
              log?.warn?.(
                "BEDROCK",
                `skipped unrecognised EventStream event type ${JSON.stringify(event.headers[":event-type"])}`,
              );
              continue;
            }

            // A CRC-valid chunk with no payload means the protocol changed under us. Dropping
            // it would silently lose content, so treat it as a failure.
            const encoded = event.payload?.bytes;
            if (!encoded) {
              return fail(
                "api_error",
                "Bedrock chunk frame carried no payload bytes",
              );
            }

            // Named `inner` rather than `event`: `event` is the decoded EventStream frame above.
            let inner;
            try {
              inner = JSON.parse(decoder.decode(Buffer.from(encoded, "base64")));
            } catch (error) {
              return fail(
                "api_error",
                `Bedrock chunk was not valid JSON (${error.message})`,
              );
            }

            if (this.isClaudeWire) {
              // Anthropic's SSE names the event after the payload's own type, and a well-formed
              // stream ends with message_stop.
              if (!inner?.type) {
                return fail(
                  "api_error",
                  "Bedrock chunk decoded to an event with no type",
                );
              }
              emit(inner.type, inner);
              if (inner.type === BEDROCK.terminalEventType) sawTerminalEvent = true;
            } else {
              // OpenAI chat.completion.chunk: no `type`, and completion is signalled by a
              // non-null finish_reason on a choice rather than a terminal event.
              if (!Array.isArray(inner?.choices)) {
                return fail(
                  "api_error",
                  "Bedrock chunk decoded without a `choices` array",
                );
              }
              emit(null, inner);
              if (inner.choices.some((c) => c?.finish_reason)) sawTerminalEvent = true;
            }
          }
          return true;
        };

        for (;;) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (error) {
            fail("api_error", `Bedrock stream read failed: ${error.message}`);
            break;
          }
          if (chunk.done) break;
          const value = chunk.value;
          if (!value?.byteLength) continue;

          if (buffer.byteLength === 0) {
            buffer = value;
          } else {
            const joined = new Uint8Array(buffer.byteLength + value.byteLength);
            joined.set(buffer);
            joined.set(value, buffer.byteLength);
            buffer = joined;
          }

          if (!drainFrames()) break;
        }

        // Trailing bytes that never formed a frame, or a stream that stopped before Anthropic's
        // terminal event, both mean the answer is incomplete. Saying so beats presenting a
        // truncated response as finished — but neither is true when the CLIENT hung up, which
        // is a normal disconnect, not a protocol failure.
        if (!downstreamCancelled) {
          if (!failed && buffer.byteLength) {
            fail("api_error", "Bedrock stream ended mid-frame");
          } else if (!failed && !sawTerminalEvent) {
            fail(
              "api_error",
              this.isClaudeWire
                ? `Bedrock stream ended before ${BEDROCK.terminalEventType}`
                : "Bedrock stream ended before any choice reported a finish_reason",
            );
          }
          // OpenAI clients expect the sentinel that closes a Chat Completions stream; Bedrock's
          // framing has no equivalent, so it is synthesised here the way a real upstream sends it.
          if (!this.isClaudeWire && !failed) {
            controller.enqueue(encoder.encode(SSE_DONE));
          }
          // Single termination path: close exactly once. A cancelled controller is already
          // closed, so closing it again would throw past the upstream release below.
          controller.close();
        }
        await reader
          .cancel()
          .catch((error) =>
            log?.debug?.("BEDROCK", `upstream cancel failed: ${error.message}`),
          );
        // cancel() aborts the body but, per the streams spec, leaves the reader holding the
        // lock. Release it so nothing stays attached to a dead stream.
        reader.releaseLock?.();
      },
      cancel: (reason) => {
        downstreamCancelled = true;
        return reader.cancel(reason);
      },
    });
  }
}

/** Copy of signed headers that is safe to write to a request log. */
function redactSignedHeaders(headers) {
  const redacted = {
    ...headers,
    Authorization: headers.Authorization.replace(/Signature=[0-9a-f]+/, "Signature=<redacted>"),
  };
  if (redacted[AWS_SIGV4.securityTokenHeader]) {
    redacted[AWS_SIGV4.securityTokenHeader] = "<redacted>";
  }
  return redacted;
}

/**
 * Check a Bedrock connection with a signed ListFoundationModels call, for the dashboard's
 * validate and Test paths. `fetchFn` is the caller's fetch, so each path keeps its own proxy
 * handling. Resolution failures (incomplete keys, an expired SSO session, a bad region) come
 * back as the error, since they are exactly what the user needs to fix.
 *
 * @returns {Promise<{valid: boolean, error: string|null}>}
 */
export async function probeBedrockCredentials(credentials, fetchFn) {
  let resolved;
  try {
    resolved = await resolveAwsCredentials(credentials);
  } catch (error) {
    return { valid: false, error: error.message };
  }

  // resolveAwsCredentials validated the region, so it is safe in the hostname.
  const url = `https://bedrock.${resolved.region}.amazonaws.com/${BEDROCK.probePath}`;
  const headers = signAwsRequest({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
    region: resolved.region,
    service: BEDROCK.service,
    credentials: resolved,
  });
  const probeCtrl = new AbortController();
  const probeTimer = setTimeout(
    () => probeCtrl.abort(new Error("AWS credential probe timed out")),
    BEDROCK.probeTimeoutMs,
  );
  let res;
  try {
    res = await fetchFn(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: probeCtrl.signal,
    });
  } catch (error) {
    if (probeCtrl.signal.aborted) {
      return { valid: false, error: "AWS credential probe timed out" };
    }
    throw error;
  } finally {
    clearTimeout(probeTimer);
  }
  if (res.ok) return { valid: true, error: null };

  const errorType = (res.headers.get(BEDROCK.errorTypeHeader) || "").split(":")[0];
  if (errorType === BEDROCK.accessDeniedErrorType) return { valid: true, error: null };

  const message = (await res.json().catch(() => null))?.message;
  return {
    valid: false,
    error: `AWS rejected the credentials (${errorType || `HTTP ${res.status}`})${message ? `: ${message}` : ""}`,
  };
}

export default BedrockExecutor;

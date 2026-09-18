import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { AWS_EVENTSTREAM, BEDROCK } from "../config/awsConstants.js";
import {
  resolveAwsCredentials,
  resolveRegion,
} from "../shared/awsCredentials.js";
import { crc32, parseEventFrame } from "../utils/awsEventStream.js";
import { escapeUri, signAwsRequest } from "../utils/awsSigv4.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_HEADERS } from "../utils/sseConstants.js";

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
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // resolveRegion validates the value; it lands in the hostname, so an unvalidated region
    // would let a connection redirect signed traffic to an arbitrary origin.
    const region = resolveRegion(credentials);

    // Fail here rather than mid-stream: a non-Anthropic Bedrock model returns chunks this
    // executor cannot read, and discovering that after the upstream call has been billed is a
    // worse experience than an upfront message naming the limitation.
    if (!BEDROCK.anthropicModelPattern.test(String(model || ""))) {
      throw new Error(
        `Bedrock model ${JSON.stringify(model)} is not an Anthropic model. This provider speaks ` +
          "the Anthropic Messages format, so it supports ids like " +
          '"us.anthropic.claude-sonnet-4-5-20250929-v1:0". Nova, Llama, Titan and Mistral on ' +
          "Bedrock use different request and response shapes and are not supported yet.",
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
    // anthropic_version goes AFTER the spread on purpose: a claude-format client may carry its
    // own (e.g. "2023-06-01"), and letting that win earns a Bedrock ValidationException.
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

    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers,
        body: payload,
        signal,
        // Bedrock never redirects. Following one would replay the body and the signed
        // x-amz-security-token at whatever origin the redirect names, so refuse instead.
        redirect: "error",
      },
      proxyOptions,
    );

    // Errors and non-streaming calls are already JSON the claude translator understands.
    if (!response.ok || !stream || !response.body) {
      return { response, url, headers, transformedBody };
    }

    return {
      response: new Response(this.eventStreamToClaudeSse(response.body, log), {
        status: response.status,
        statusText: response.statusText,
        headers: { ...SSE_HEADERS },
      }),
      url,
      headers,
      transformedBody,
    };
  }

  /**
   * Unwrap AWS EventStream framing into Claude SSE.
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
  eventStreamToClaudeSse(upstream, log = null) {
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
          controller.enqueue(
            encoder.encode(
              `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        /** Record a protocol failure as a Claude error event. Returns false to stop draining. */
        const fail = (type, message) => {
          if (failed) return false;
          failed = true;
          log?.error?.("BEDROCK", `${type}: ${message}`);
          emit("error", { type: "error", error: { type, message } });
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

            if (event.headers[":event-type"] !== BEDROCK.chunkEventName)
              continue;

            // A CRC-valid chunk with no payload means the protocol changed under us. Dropping
            // it would silently lose content, so treat it as a failure.
            const encoded = event.payload?.bytes;
            if (!encoded) {
              return fail(
                "api_error",
                "Bedrock chunk frame carried no payload bytes",
              );
            }

            let anthropicEvent;
            try {
              anthropicEvent = JSON.parse(
                decoder.decode(Buffer.from(encoded, "base64")),
              );
            } catch (error) {
              return fail(
                "api_error",
                `Bedrock chunk was not valid JSON (${error.message})`,
              );
            }

            if (!anthropicEvent?.type) {
              return fail(
                "api_error",
                "Bedrock chunk decoded to an event with no type",
              );
            }

            // Anthropic's SSE names the event after the payload's own type.
            emit(anthropicEvent.type, anthropicEvent);
            if (anthropicEvent.type === BEDROCK.terminalEventType)
              sawTerminalEvent = true;
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
              `Bedrock stream ended before ${BEDROCK.terminalEventType}`,
            );
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

export default BedrockExecutor;

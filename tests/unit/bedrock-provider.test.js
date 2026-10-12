import { describe, expect, it, vi } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import {
  getProviderModels,
  isValidModel,
} from "../../open-sse/config/providerModels.js";
import {
  getExecutor,
  hasSpecializedExecutor,
} from "../../open-sse/executors/index.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { encodeEventFrame } from "../../open-sse/utils/awsEventStream.js";
import { BEDROCK } from "../../open-sse/config/awsConstants.js";

const MODEL = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const PROFILE_CREDS = {
  providerSpecificData: { profile: "sso", region: "eu-central-1" },
};

/** Wrap an Anthropic streaming event the way Bedrock does: base64 inside a `chunk` frame. */
function chunkFrame(anthropicEvent) {
  return encodeEventFrame(
    { ":event-type": BEDROCK.chunkEventName, ":message-type": "event" },
    { bytes: Buffer.from(JSON.stringify(anthropicEvent)).toString("base64") },
  );
}

function streamOf(...byteChunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of byteChunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("Bedrock provider registration", () => {
  it("registers with the claude wire format so existing translators are reused", () => {
    expect(PROVIDERS.bedrock?.format).toBe("claude");
  });

  it("exposes a specialised executor under both the id and the br alias", () => {
    expect(hasSpecializedExecutor("bedrock")).toBe(true);
    expect(hasSpecializedExecutor("br")).toBe(true);
    expect(getExecutor("bedrock").constructor.name).toBe("BedrockExecutor");
    expect(getExecutor("br").constructor.name).toBe("BedrockExecutor");
  });

  it("lists curated models but accepts any id, since the catalogue is region-dependent", () => {
    expect(getProviderModels("br").length).toBeGreaterThan(0);
    expect(isValidModel("br", MODEL)).toBe(true);
    expect(
      isValidModel("br", "meta.llama3-70b-instruct-v1:0", new Set(["br"])),
    ).toBe(true);
  });

  it("routes a prefixed model to the bedrock provider", async () => {
    await expect(getModelInfoCore(`bedrock/${MODEL}`, {})).resolves.toEqual({
      provider: "bedrock",
      model: MODEL,
    });
  });
});

describe("Bedrock request shaping", () => {
  const executor = getExecutor("bedrock");

  it("targets the regional runtime host and the streaming action", () => {
    expect(executor.buildUrl(MODEL, true, 0, PROFILE_CREDS)).toBe(
      "https://bedrock-runtime.eu-central-1.amazonaws.com/model/" +
        "us.anthropic.claude-sonnet-4-20250514-v1%3A0/invoke-with-response-stream",
    );
  });

  it("uses the plain invoke action when not streaming", () => {
    expect(executor.buildUrl(MODEL, false, 0, PROFILE_CREDS)).toMatch(
      /\/invoke$/,
    );
  });

  it("escapes the colon in the model version, which is required for a valid signature", () => {
    expect(executor.buildUrl(MODEL, true, 0, PROFILE_CREDS)).toContain(
      "v1%3A0",
    );
  });

  it("honours an ambient AWS_REGION when the connection sets none", () => {
    const previous = process.env.AWS_REGION;
    process.env.AWS_REGION = "ap-northeast-1";
    try {
      expect(
        executor.buildUrl(MODEL, true, 0, { providerSpecificData: {} }),
      ).toContain("bedrock-runtime.ap-northeast-1.");
    } finally {
      if (previous === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previous;
    }
  });

  it("falls back to the default region when neither connection nor env sets one", () => {
    // Must be hermetic: a developer with AWS_REGION exported would otherwise see this pass
    // or fail depending on their shell.
    const previous = {
      region: process.env.AWS_REGION,
      fallback: process.env.AWS_DEFAULT_REGION,
    };
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    try {
      expect(
        executor.buildUrl(MODEL, true, 0, { providerSpecificData: {} }),
      ).toContain(`bedrock-runtime.${BEDROCK.defaultRegion}.`);
    } finally {
      if (previous.region !== undefined)
        process.env.AWS_REGION = previous.region;
      if (previous.fallback !== undefined)
        process.env.AWS_DEFAULT_REGION = previous.fallback;
    }
  });

  it("swaps model and stream for anthropic_version, which Bedrock demands", () => {
    const body = {
      model: MODEL,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 8,
    };
    const transformed = executor.transformRequest(
      MODEL,
      body,
      true,
      PROFILE_CREDS,
    );

    // Bedrock rejects a body carrying `model`; the id belongs in the URL only.
    expect(transformed).not.toHaveProperty("model");
    expect(transformed).not.toHaveProperty("stream");
    expect(transformed.anthropic_version).toBe(BEDROCK.anthropicVersion);
    expect(transformed.messages).toEqual(body.messages);
    expect(transformed.max_tokens).toBe(8);
  });
});

describe("Bedrock EventStream to Claude SSE", () => {
  const executor = getExecutor("bedrock");

  it("unwraps base64 chunk payloads into named Claude SSE events", async () => {
    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(
          chunkFrame({ type: "message_start", message: { id: "msg_1" } }),
          chunkFrame({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hi" },
          }),
          chunkFrame({ type: "message_stop" }),
        ),
      ),
    );

    expect(sse).toContain("event: message_start");
    expect(sse).toContain("event: content_block_delta");
    expect(sse).toContain('"text":"Hi"');
    expect(sse).toContain("event: message_stop");
  });

  it("reassembles a frame split across network chunk boundaries", async () => {
    const frame = chunkFrame({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "split" },
    });
    const cut = Math.floor(frame.length / 2);

    // TCP gives no guarantee a frame arrives whole; buffering it is the whole point.
    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(frame.slice(0, cut), frame.slice(cut)),
      ),
    );

    expect(sse).toContain('"text":"split"');
  });

  it("skips an unrecognised event type visibly: it warns and the stream still completes", async () => {
    const unknown = encodeEventFrame(
      { ":event-type": "metadata", ":message-type": "event" },
      { anything: true },
    );
    const log = { warn: vi.fn(), error: vi.fn() };

    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(
          chunkFrame({ type: "message_start", message: { id: "msg_1" } }),
          unknown,
          chunkFrame({ type: "message_stop" }),
        ),
        log,
      ),
    );

    expect(log.warn).toHaveBeenCalledWith("BEDROCK", expect.stringContaining('"metadata"'));
    expect(log.error).not.toHaveBeenCalled();
    expect(sse).not.toContain("event: error");
    expect(sse).toContain("event: message_stop");
  });

  it("surfaces an in-band exception frame instead of ending the stream silently", async () => {
    const exception = encodeEventFrame(
      {
        ":message-type": "exception",
        ":exception-type": "throttlingException",
      },
      { message: "Too many tokens, please wait" },
    );

    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(chunkFrame({ type: "message_start", message: {} }), exception),
      ),
    );

    // Bedrock reports throttling as a frame, not an HTTP status; swallowing it would look
    // like a successful but truncated answer.
    expect(sse).toContain("event: error");
    expect(sse).toContain("throttlingException");
    expect(sse).toContain("Too many tokens, please wait");
  });

  it("reports a stream that ends mid-frame rather than truncating silently", async () => {
    const frame = chunkFrame({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "x" },
    });

    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(frame.slice(0, frame.length - 4)),
      ),
    );

    expect(sse).toContain("event: error");
    expect(sse).toContain("ended mid-frame");
  });

  it("rejects a corrupted frame via the message CRC", async () => {
    const frame = chunkFrame({ type: "message_stop" });
    const corrupted = Uint8Array.from(frame);
    corrupted[corrupted.length - 2] ^= 0xff;

    const sse = await readAll(
      executor.eventStreamToSse(streamOf(corrupted)),
    );

    expect(sse).toContain("event: error");
    expect(sse).toContain("CRC mismatch");
  });
});

// Regression tests for findings from the pre-merge adversarial review.
describe("Bedrock hardening (adversarial review regressions)", () => {
  const executor = getExecutor("bedrock");

  it("refuses to build a URL for a region that would change the host", () => {
    // "evil.com/x" previously produced host "bedrock-runtime.evil.com", sending the signed
    // body and the x-amz-security-token to an attacker-chosen origin.
    expect(() =>
      executor.buildUrl(MODEL, true, 0, {
        providerSpecificData: { region: "evil.com/x" },
      }),
    ).toThrow(/Invalid AWS region/);
    expect(() =>
      executor.buildUrl(MODEL, true, 0, {
        providerSpecificData: { region: "foo@evil.com" },
      }),
    ).toThrow(/Invalid AWS region/);
  });

  it("releases the upstream reader and cancels it when a frame errors", async () => {
    const exception = encodeEventFrame(
      {
        ":message-type": "exception",
        ":exception-type": "throttlingException",
      },
      { message: "slow down" },
    );
    let cancelled = false;
    // Deliberately left OPEN: a real HTTP response body is still streaming when an in-band
    // exception frame arrives, and that is the case where failing to cancel holds the
    // connection. An already-closed stream never invokes its source's cancel() at all.
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(exception);
      },
      cancel() {
        cancelled = true;
      },
    });

    const sse = await readAll(executor.eventStreamToSse(upstream));

    expect(sse).toContain("throttlingException");

    // Teardown continues after the consumer sees `done`, so let it settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Leaving the reader locked and the upstream un-cancelled held the connection open on
    // every throttle or framing error.
    expect(cancelled).toBe(true);
    expect(upstream.locked).toBe(false);
  });

  it("reports a stream that ends before message_stop instead of looking complete", async () => {
    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(
          chunkFrame({ type: "message_start", message: {} }),
          chunkFrame({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "half" },
          }),
        ),
      ),
    );

    // A proxy can close an HTTP response cleanly while truncating the Anthropic protocol; that
    // must not be presented to the client as a finished answer.
    expect(sse).toContain('"text":"half"');
    expect(sse).toContain("event: error");
    expect(sse).toContain("message_stop");
  });

  it("errors on a chunk frame with no payload rather than dropping content", async () => {
    const empty = encodeEventFrame(
      { ":event-type": BEDROCK.chunkEventName, ":message-type": "event" },
      {},
    );
    const sse = await readAll(executor.eventStreamToSse(streamOf(empty)));

    expect(sse).toContain("event: error");
    expect(sse).toContain("no payload bytes");
  });

  it("errors on a decoded event with no type rather than dropping it", async () => {
    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(chunkFrame({ delta: "orphan" })),
      ),
    );

    expect(sse).toContain("event: error");
    expect(sse).toContain("no type");
  });

  it("emits exactly one error event per failed stream", async () => {
    const sse = await readAll(
      executor.eventStreamToSse(
        streamOf(chunkFrame({ type: "message_start", message: {} })),
      ),
    );

    // The terminal-event check and the teardown must not both fire.
    expect(sse.match(/^event: error$/gm)?.length).toBe(1);
  });
  it("treats a client disconnect as normal, not as a truncated answer", async () => {
    const logged = [];
    let cancelled = false;
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunkFrame({ type: "message_start", message: {} }));
      },
      cancel() {
        cancelled = true;
      },
    });

    const out = executor.eventStreamToSse(upstream, {
      error: (_tag, message) => logged.push(message),
      debug: () => {},
    });
    const reader = out.getReader();
    await reader.read();
    await reader.cancel("client went away");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A client hanging up legitimately never reaches message_stop. Reporting that as a protocol
    // error logged a false failure, and the enqueue threw past the upstream release.
    expect(logged).toEqual([]);
    expect(cancelled).toBe(true);
    // Load-bearing: the teardown must sit OUTSIDE the downstreamCancelled gate. If it is ever
    // moved inside, the disconnect path stops releasing the reader and this catches it.
    expect(upstream.locked).toBe(false);
  });
});

describe("Bedrock body shaping hardening", () => {
  const executor = getExecutor("bedrock");

  it("keeps the Bedrock anthropic_version even when the client sends its own", () => {
    // A claude-format client may carry anthropic_version: "2023-06-01"; letting that through
    // earns a Bedrock ValidationException on every request.
    const transformed = executor.transformRequest(
      MODEL,
      { model: MODEL, stream: true, anthropic_version: "2023-06-01", messages: [] },
      true,
      PROFILE_CREDS,
    );
    expect(transformed.anthropic_version).toBe(BEDROCK.anthropicVersion);
  });
});

describe("Bedrock model family guard", () => {
  const executor = getExecutor("bedrock");

  it("accepts every Anthropic profile shape AWS actually serves", () => {
    for (const id of [
      "us.anthropic.claude-opus-5",
      "global.anthropic.claude-sonnet-5",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "anthropic.claude-3-haiku-20240307-v1:0",
    ]) {
      expect(() => executor.buildUrl(id, true, 0, PROFILE_CREDS)).not.toThrow();
    }
  });

  it("rejects a non-Anthropic Bedrock model before the call is billed", () => {
    // These would otherwise sail through passthroughModels and die mid-stream on a chunk with
    // no `type`, after the upstream request had already been paid for.
    for (const id of [
      "amazon.nova-pro-v1:0",
      "meta.llama3-70b-instruct-v1:0",
      "mistral.mistral-large-2407-v1:0",
    ]) {
      expect(() => executor.buildUrl(id, true, 0, PROFILE_CREDS)).toThrow(
        /not supported by the bedrock provider, which expects an Anthropic model/,
      );
    }
  });
});

// xAI Grok on Bedrock speaks OpenAI Chat Completions, not the Anthropic Messages format. It gets
// its own registry entry sharing this executor, the way vertex / vertex-partner do.
describe("Bedrock xAI entry (OpenAI wire)", () => {
  const xai = getExecutor("bedrock-xai");
  const XAI_MODEL = "us.xai.grok-4.6";
  const CREDS = { providerSpecificData: { profile: "sso", region: "us-west-2" } };

  /** Bedrock frames an OpenAI chunk exactly the same way; only the payload shape differs. */
  const openaiChunk = (obj) =>
    encodeEventFrame(
      { ":event-type": BEDROCK.chunkEventName, ":message-type": "event" },
      { bytes: Buffer.from(JSON.stringify(obj)).toString("base64") },
    );

  it("registers with the openai wire format so no response translation is needed", () => {
    // Grok returns `choices` natively, so the default OpenAI path applies end to end.
    expect(PROVIDERS["bedrock-xai"]?.format ?? "openai").toBe("openai");
    expect(hasSpecializedExecutor("bedrock-xai")).toBe(true);
    expect(hasSpecializedExecutor("brx")).toBe(true);
    expect(xai.constructor.name).toBe("BedrockExecutor");
  });

  it("routes both the id and the brx alias", async () => {
    await expect(getModelInfoCore(`bedrock-xai/${XAI_MODEL}`, {})).resolves.toEqual({
      provider: "bedrock-xai",
      model: XAI_MODEL,
    });
    expect(getProviderModels("brx").length).toBeGreaterThan(0);
  });

  it("does not inject anthropic_version, which Grok would ignore anyway", () => {
    const transformed = xai.transformRequest(
      XAI_MODEL,
      { model: XAI_MODEL, stream: true, messages: [{ role: "user", content: "hi" }], max_tokens: 2000 },
      true,
      CREDS,
    );
    expect(transformed).not.toHaveProperty("anthropic_version");
    expect(transformed).not.toHaveProperty("model");
    expect(transformed).not.toHaveProperty("stream");
    expect(transformed.max_tokens).toBe(2000);
  });

  it("keeps the two entries' model families apart in both directions", () => {
    // Sending an Anthropic id to the OpenAI wire, or vice versa, would fail mid-stream after the
    // upstream call was billed, so each entry rejects the other's family upfront.
    expect(() => xai.buildUrl(MODEL, true, 0, CREDS)).toThrow(/not supported by the bedrock-xai/);
    expect(() => getExecutor("bedrock").buildUrl(XAI_MODEL, true, 0, CREDS)).toThrow(
      /not supported by the bedrock/,
    );
    expect(() => xai.buildUrl(XAI_MODEL, true, 0, CREDS)).not.toThrow();
  });

  it("emits bare OpenAI data lines terminated by [DONE], not named Claude events", async () => {
    const sse = await readAll(
      xai.eventStreamToSse(
        streamOf(
          openaiChunk({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }),
          openaiChunk({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "GROK" }, finish_reason: null }] }),
          openaiChunk({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        ),
      ),
    );

    expect(sse).toContain('"content":"GROK"');
    // An `event:` line here would be junk the OpenAI parsers must skip.
    expect(sse).not.toContain("event: ");
    expect(sse).toContain("data: [DONE]");
    // finish_reason is the OpenAI terminal signal, so no truncation error should fire.
    expect(sse).not.toContain('"error"');
  });

  it("treats a missing finish_reason as truncation on the OpenAI wire", async () => {
    const sse = await readAll(
      xai.eventStreamToSse(
        streamOf(openaiChunk({ choices: [{ index: 0, delta: { content: "half" }, finish_reason: null }] })),
      ),
    );
    expect(sse).toContain("finish_reason");
    expect(sse).toContain("error");
  });

  it("rejects a chunk with no choices array rather than dropping content", async () => {
    const sse = await readAll(xai.eventStreamToSse(streamOf(openaiChunk({ id: "x" }))));
    expect(sse).toContain("`choices` array");
  });
});

// Guard against the mistake that shipped three times: expressing a capability as a provider id.
// The API-key exemption, the Save guard and the credentials form were each gated on
// `provider === "bedrock"` at some point, which silently left bedrock-xai unconfigurable.
describe("Bedrock dashboard capability flags", () => {
  it("declares the AWS credential form and API-key substitute on EVERY Bedrock entry", async () => {
    const { AI_PROVIDERS } = await import("@/shared/constants/providers");
    const bedrockEntries = Object.values(AI_PROVIDERS).filter((p) =>
      String(p.id || "").startsWith("bedrock"),
    );

    expect(bedrockEntries.length).toBeGreaterThanOrEqual(2);
    for (const entry of bedrockEntries) {
      // Without credentialForm the dashboard renders no Profile/Region inputs at all, so an
      // SSO connection cannot be created from the UI.
      expect(entry.credentialForm, `${entry.id} credentialForm`).toBe("aws");
      // Without this the Save button and handleSubmit both demand an API key that SSO mode
      // has no way to supply.
      expect(entry.apiKeyOptionalWith, `${entry.id} apiKeyOptionalWith`).toBe("profile");
    }
  });
});

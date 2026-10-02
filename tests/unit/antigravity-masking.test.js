import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const MODEL = "gemini-3.8-flash-medium";
const RFC_LINE = "RFC 2119: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL.";
const SYSTEM_MARKER = [
  "<SyStEm-Conventions>",
  RFC_LINE,
  "System instruction body must remain intact.",
  "</system_conventions>",
  "<SYSTEM_directive>Directive body must remain intact.</system-directive>",
  "<CrItIcAl>Critical body must remain intact.</CRITICAL>",
  "Oh My Pi coding harness; Oh My Pi; omp Live; OpenCode; OPENCODE; opencode; oPeNcOdE",
].join("\n");
const OUTSIDE_MARKER = "<system-conventions> outside instruction data Oh My Pi omp Live";

function credentials() {
  return {
    accessToken: "synthetic-token",
    projectId: "synthetic-project",
    connectionId: "synthetic-connection",
  };
}

function noOpLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function standardBody({ stream = true, requestType, systemInstruction = SYSTEM_MARKER } = {}) {
  const normalizedSystemInstruction = typeof systemInstruction === "string"
    ? { role: "user", parts: [{ text: systemInstruction }] }
    : systemInstruction;
  const body = {
    model: MODEL,
    stream,
    stream_options: { include_usage: true },
    used_claude: "root telemetry",
    used_claude_conservative: "root conservative telemetry",
    labels: {
      used_claude: "root label telemetry",
      used_claude_conservative: "root conservative label telemetry",
      keep: "root label",
    },
    request: {
      requestType: "nested-request-type-must-survive",
      used_claude: "request telemetry",
      used_claude_conservative: "request conservative telemetry",
      labels: {
        used_claude: "request label telemetry",
        used_claude_conservative: "request conservative label telemetry",
        keep: "request label",
      },
      systemInstruction: normalizedSystemInstruction,
      contents: [{ role: "user", parts: [{ text: "Reply only pong" }] }],
      generationConfig: { maxOutputTokens: 256 },
    },
  };

  if (requestType !== undefined) body.requestType = requestType;
  return body;
}

function responseFor(stream, status = 200) {
  const body = stream
    ? "data: {\"candidates\":[]}\n\n"
    : "{\"candidates\":[]}";
  return new Response(body, {
    status,
    headers: { "content-type": stream ? "text/event-stream" : "application/json" },
  });
}

function lastWireBody() {
  const [, options] = fetchMock.mock.calls.at(-1);
  return JSON.parse(options.body);
}

function withoutGeneratedRequestId(value) {
  const copy = structuredClone(value);
  delete copy.requestId;
  return copy;
}

function assertNeutralizedSystemText(text) {
  expect(text).toContain("<conventions>");
  expect(text).toContain("</conventions>");
  expect(text).toContain("<instructions>");
  expect(text).toContain("</instructions>");
  expect(text).toContain("<important>");
  expect(text).toContain("</important>");
  expect(text).toContain(RFC_LINE);
  expect(text).toContain("AI coding assistant; coding assistant; coding assistant live; Antigravity; ANTIGRAVITY; antigravity; antigravity");
  expect(text).not.toMatch(/<\/?system[-_]conventions>/i);
  expect(text).not.toMatch(/<\/?system[-_]directive>/i);
  expect(text).not.toMatch(/<\/?critical>/i);
  expect(text).not.toMatch(/Oh My Pi|omp Live/i);
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("Antigravity instruction masking", () => {
  it("neutralizes only system instruction text and preserves parts and bodies", () => {
    const body = standardBody();
    body.request.systemInstruction = {
      role: "user",
      metadata: { preserve: true },
      parts: [
        { text: SYSTEM_MARKER, partMetadata: "preserve" },
        { text: "A second unchanged instruction part", custom: { preserve: true } },
        { inlineData: { mimeType: "image/png", data: "image-bytes" }, custom: "non-text" },
        { text: 42, custom: "non-string" },
      ],
    };
    const original = structuredClone(body);

    const output = new AntigravityExecutor().transformRequest(MODEL, body, true, credentials());
    const [maskedPart, unchangedPart, nonTextPart, nonStringPart] = output.request.systemInstruction.parts;

    assertNeutralizedSystemText(maskedPart.text);
    expect(maskedPart.partMetadata).toBe("preserve");
    expect(unchangedPart).toEqual({ text: "A second unchanged instruction part", custom: { preserve: true } });
    expect(nonTextPart).toEqual({ inlineData: { mimeType: "image/png", data: "image-bytes" }, custom: "non-text" });
    expect(nonStringPart).toEqual({ text: 42, custom: "non-string" });
    expect(output.request.systemInstruction.metadata).toEqual({ preserve: true });
    expect(body).toEqual(original);
  });

  it("leaves user/model text, tool data, arguments, responses, and schema keys unchanged", () => {
    const body = standardBody();
    body.request.contents = [
      {
        role: "user",
        parts: [
          { text: OUTSIDE_MARKER },
          {
            functionCall: {
              id: "call-marker",
              name: "marker_tool",
              args: { prompt: OUTSIDE_MARKER, used_claude: "function-call telemetry-like data" },
            },
          },
          {
            functionResponse: {
              id: "call-marker",
              name: "marker_tool",
              response: { result: OUTSIDE_MARKER, used_claude: "function-response telemetry-like data" },
            },
          },
        ],
      },
      { role: "model", parts: [{ text: OUTSIDE_MARKER }] },
    ];
    body.request.tools = [{
      functionDeclarations: [{
        name: "marker_tool",
        description: OUTSIDE_MARKER,
        parameters: {
          type: "object",
          properties: {
            used_claude: { type: "string", description: OUTSIDE_MARKER },
            "<system-conventions>": { type: "string" },
          },
        },
      }],
    }];
    const original = structuredClone(body);

    const output = new AntigravityExecutor().transformRequest(MODEL, body, true, credentials());
    const serializedContents = JSON.stringify(output.request.contents);
    const functionDeclaration = output.request.tools[0].functionDeclarations[0];

    expect(serializedContents).toContain(OUTSIDE_MARKER);
    expect(output.request.contents[0].parts[1].functionCall.args.prompt).toBe(OUTSIDE_MARKER);
    expect(output.request.contents[0].parts[2].functionResponse.response).toEqual({
      result: OUTSIDE_MARKER,
      used_claude: "function-response telemetry-like data",
    });
    expect(functionDeclaration.description).toBe(OUTSIDE_MARKER);
    expect(functionDeclaration.parameters.properties.used_claude.description).toBe(OUTSIDE_MARKER);
    expect(functionDeclaration.parameters.properties["<system-conventions>"]).toEqual({ type: "string" });
    expect(body).toEqual(original);
  });

  it.each([true, false])(
    "removes requestType and harness telemetry from chat envelopes in %s mode",
    (stream) => {
      const body = standardBody({ stream, requestType: "agent" });
      const original = structuredClone(body);
      const output = new AntigravityExecutor().transformRequest(MODEL, body, stream, credentials());

      expect(output).not.toHaveProperty("requestType");
      expect(output.request.requestType).toBe("nested-request-type-must-survive");
      expect(output).not.toHaveProperty("used_claude");
      expect(output).not.toHaveProperty("used_claude_conservative");
      expect(output.labels).toEqual({ keep: "root label" });
      expect(output.request).not.toHaveProperty("used_claude");
      expect(output.request).not.toHaveProperty("used_claude_conservative");
      expect(output.request.labels).toEqual({ keep: "request label" });
      expect(stream ? output.stream_options : output.stream_options).toEqual(stream ? { include_usage: true } : undefined);
      expect(body).toEqual(original);

      const repeated = new AntigravityExecutor().transformRequest(MODEL, body, stream, credentials());
      expect(withoutGeneratedRequestId(repeated)).toEqual(withoutGeneratedRequestId(output));
    },
  );

  it("preserves an empty labels object and strips telemetry only at direct metadata roots", () => {
    const body = standardBody({ requestType: undefined });
    body.labels = {};
    body.request.labels = {};
    body.request.contents = [{
      role: "user",
      parts: [{ functionResponse: { response: { used_claude: "tool data" } } }],
    }];
    const output = new AntigravityExecutor().transformRequest(MODEL, body, true, credentials());

    expect(output.labels).toEqual({});
    expect(output.request.labels).toEqual({});
    expect(output.request.contents[0].parts[0].functionResponse.response.used_claude).toBe("tool data");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty parts", { role: "user", parts: [] }],
    ["non-string text", { role: "user", parts: [{ text: 123 }, { text: null }, { metadata: true }] }],
  ])("does not manufacture instructions for %s systemInstruction", (_label, systemInstruction) => {
    const body = standardBody({ systemInstruction });
    if (systemInstruction === undefined) delete body.request.systemInstruction;
    const original = structuredClone(body);
    const output = new AntigravityExecutor().transformRequest(MODEL, body, true, credentials());

    expect(output.request.systemInstruction).toEqual(systemInstruction);
    expect(body).toEqual(original);
  });

  it("keeps the existing image generation envelope and prompt", () => {
    const body = {
      model: "gemini-3.1-flash-image-16x9",
      stream: false,
      requestType: "incoming-type",
      request: {
        contents: [{ role: "user", parts: [{ text: "Create a sunrise over the ocean" }] }],
      },
    };
    const original = structuredClone(body);
    const output = new AntigravityExecutor().transformRequest(body.model, body, false, credentials());

    expect(output.requestType).toBe("image_gen");
    expect(output.request.contents).toEqual([{ role: "user", parts: [{ text: "Create a sunrise over the ocean" }] }]);
    expect(body).toEqual(original);
  });

  it.each([true, false])("normalizes serialized outbound payloads and preserves response bytes (%s)", async (stream) => {
    const body = standardBody({ stream, requestType: "agent" });
    const original = structuredClone(body);
    const expectedResponse = stream ? "data: {\"candidates\":[]}\n\n" : "{\"candidates\":[]}";
    fetchMock.mockResolvedValueOnce(responseFor(stream));

    const result = await new AntigravityExecutor().execute({
      model: MODEL,
      body,
      stream,
      credentials: credentials(),
      log: noOpLogger(),
    });
    const wire = lastWireBody();
    const wireSystemText = wire.request.systemInstruction.parts
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");

    assertNeutralizedSystemText(wireSystemText);
    expect(wire).not.toHaveProperty("requestType");
    expect(wire.request.labels).toEqual({ keep: "request label" });
    expect(wire.labels).toEqual({ keep: "root label" });
    expect(await result.response.text()).toBe(expectedResponse);
    expect(body).toEqual(original);
  });

  it("normalizes every endpoint fallback attempt without mutating the caller", async () => {
    const body = standardBody({ stream: false, requestType: "agent" });
    const original = structuredClone(body);
    const executor = new AntigravityExecutor();
    executor.config = {
      ...executor.config,
      baseUrls: ["https://synthetic-first.invalid", "https://synthetic-second.invalid"],
      retry: {
        ...executor.config.retry,
        "429": { attempts: 0 },
        "500": { attempts: 0 },
        "503": { attempts: 0 },
      },
    };
    fetchMock
      .mockResolvedValueOnce(responseFor(false, 429))
      .mockResolvedValueOnce(responseFor(false, 200));

    const result = await executor.execute({
      model: MODEL,
      body,
      stream: false,
      credentials: credentials(),
      log: noOpLogger(),
    });
    const wires = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wires).toHaveLength(2);
    for (const wire of wires) {
      const text = wire.request.systemInstruction.parts.map((part) => part.text || "").join("\n");
      assertNeutralizedSystemText(text);
      expect(wire).not.toHaveProperty("requestType");
    }
    expect(result.response.status).toBe(200);
    expect(body).toEqual(original);
  });
});

describe("Antigravity masking through translation and combos", () => {
  it("masks real translated instructions from every supported source format", async () => {
    const fixtures = [
      {
        name: "openai",
        source: FORMATS.OPENAI,
        body: {
          model: "client-model",
          messages: [
            { role: "system", content: SYSTEM_MARKER },
            { role: "developer", content: `Developer instruction ${SYSTEM_MARKER}` },
            { role: "user", content: "Reply only pong" },
          ],
        },
      },
      {
        name: "openai responses",
        source: FORMATS.OPENAI_RESPONSES,
        body: {
          model: "client-model",
          instructions: SYSTEM_MARKER,
          input: [{
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Reply only pong" }],
          }],
        },
      },
      {
        name: "claude",
        source: FORMATS.CLAUDE,
        body: {
          model: "client-model",
          system: SYSTEM_MARKER,
          messages: [{ role: "user", content: "Reply only pong" }],
          max_tokens: 256,
        },
      },
      {
        name: "gemini",
        source: FORMATS.GEMINI,
        body: {
          model: "client-model",
          systemInstruction: { role: "user", parts: [{ text: SYSTEM_MARKER }] },
          contents: [{ role: "user", parts: [{ text: "Reply only pong" }] }],
        },
      },
    ];

    for (const fixture of fixtures) {
      fetchMock.mockResolvedValueOnce(responseFor(false));
      const sourceBody = structuredClone(fixture.body);
      const translated = translateRequest(
        fixture.source,
        FORMATS.ANTIGRAVITY,
        MODEL,
        fixture.body,
        false,
        credentials(),
        "antigravity",
        noOpLogger(),
      );
      const result = await new AntigravityExecutor().execute({
        model: MODEL,
        body: translated,
        stream: false,
        credentials: credentials(),
        log: noOpLogger(),
      });
      const wire = lastWireBody();
      const wireSystemText = (wire.request.systemInstruction?.parts || [])
        .filter((part) => typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");

      expect(result.response.status, fixture.name).toBe(200);
      assertNeutralizedSystemText(wireSystemText);
      expect(wireSystemText, fixture.name).toContain("System instruction body must remain intact.");
      expect(fixture.body).toEqual(sourceBody);
    }
  });

  it("normalizes Antigravity attempts while combo fallback reuses the original prompt", async () => {
    const body = {
      model: "custom-antigravity-combo",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_MARKER },
        { role: "user", content: "Reply only pong" },
      ],
    };
    const original = structuredClone(body);
    const seen = [];
    fetchMock
      .mockResolvedValueOnce(responseFor(false, 429))
      .mockResolvedValueOnce(responseFor(false, 200));

    const result = await handleComboChat({
      body,
      models: ["antigravity/gemini-3.8-flash-medium", "antigravity/gemini-3.8-flash-low"],
      comboStrategy: "fallback",
      autoSwitch: false,
      comboName: "synthetic-antigravity-masking",
      log: noOpLogger(),
      handleSingleModel: async (comboBody, modelString) => {
        const model = modelString.slice(modelString.indexOf("/") + 1);
        const translated = translateRequest(
          FORMATS.OPENAI,
          FORMATS.ANTIGRAVITY,
          model,
          comboBody,
          false,
          credentials(),
          "antigravity",
          noOpLogger(),
        );
        const executor = new AntigravityExecutor();
        executor.config = {
          ...executor.config,
          retry: {
            ...executor.config.retry,
            "429": { attempts: 0 },
          },
        };
        const attempt = await executor.execute({
          model,
          body: translated,
          stream: false,
          credentials: credentials(),
          log: noOpLogger(),
        });
        const wire = lastWireBody();
        seen.push({ model, wire });
        if (seen.length === 2) {
          expect(comboBody.messages[0].content).toBe(SYSTEM_MARKER);
        }
        return attempt.response;
      },
    });

    expect(result.status).toBe(200);
    expect(seen).toHaveLength(2);
    for (const { wire } of seen) {
      const text = wire.request.systemInstruction.parts.map((part) => part.text || "").join("\n");
      assertNeutralizedSystemText(text);
      expect(wire).not.toHaveProperty("requestType");
    }
    expect(body).toEqual(original);
  });
});

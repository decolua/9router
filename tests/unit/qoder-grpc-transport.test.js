// Qoder's HTTP surfaces cap request bodies at ~256 KiB (~60K tokens) and answer
// `500 internal server error` beyond that, while the roster advertises 1M-token
// windows. The model-server gRPC surface
// (`model.chat.ChatService/ChatCompletionStream`) carries up to ~8M characters
// (~1.9M tokens), so billed rows dispatch there. Free-tier rows (`lite`) are
// refused on gRPC with `116 quota exceeded` and must stay on the COSY surface.
//
// Everything here is pure: request building, transport selection, gRPC status
// mapping and chunk translation. No network, no gRPC client.
import { describe, expect, it } from "vitest";
import {
  buildQoderGrpcRequest,
  jsonToStruct,
  qoderBodyBytes,
  jsonToValue,
  mapGrpcStatusToHttp,
  qoderGrpcMetadataValues,
  qoderGrpcSessionId,
  resolveQoderTransport,
  structToJson,
  translateGrpcChunk,
  valueToJson,
} from "../../open-sse/executors/qoder-grpc.js";

const BILLED = { key: "dmodel", display_name: "DeepSeek-V4-Pro", is_free: false, max_input_tokens: 1_000_000 };
const FREE = { key: "lite", display_name: "Lite", is_free: true };

describe("resolveQoderTransport", () => {
  const SMALL = 4 * 1024;
  const LARGE = 270 * 1024;

  it("keeps a normal-size request on the HTTP surface", () => {
    expect(resolveQoderTransport(undefined, BILLED, SMALL)).toBe("cosy");
  });

  it("upgrades to gRPC once the body would exceed the HTTP cap", () => {
    expect(resolveQoderTransport(undefined, BILLED, LARGE)).toBe("grpc");
  });

  it("keeps free-tier rows on cosy, where they are served", () => {
    expect(resolveQoderTransport(undefined, FREE, SMALL)).toBe("cosy");
    expect(resolveQoderTransport(undefined, FREE, LARGE)).toBe("cosy");
    expect(resolveQoderTransport("grpc", FREE, LARGE)).toBe("cosy");
  });

  it("recognises the free tier by model key when the catalog does not say", () => {
    // The live catalog does not mark `lite` as free, so the key alone has to
    // keep it off gRPC — where it would be refused with 116.
    expect(resolveQoderTransport("grpc", { key: "lite" }, LARGE, "lite")).toBe("cosy");
    expect(resolveQoderTransport(undefined, { key: "dmodel" }, LARGE, "dmodel")).toBe("grpc");
  });

  it("honours an explicit override in both directions", () => {
    expect(resolveQoderTransport("cosy", BILLED, LARGE)).toBe("cosy");
    expect(resolveQoderTransport("grpc", BILLED, SMALL)).toBe("grpc");
  });

  it("treats an unknown override as unset", () => {
    expect(resolveQoderTransport("nonsense", BILLED, SMALL)).toBe("cosy");
    expect(resolveQoderTransport("  GRPC  ", BILLED, SMALL)).toBe("grpc");
  });

  it("treats a missing model config as billed", () => {
    expect(resolveQoderTransport(undefined, undefined, SMALL)).toBe("cosy");
    expect(resolveQoderTransport(undefined, undefined, LARGE)).toBe("grpc");
  });
});

describe("qoderBodyBytes", () => {
  it("measures the serialized body, which is what the cap counts", () => {
    const body = { messages: [{ role: "user", content: "x".repeat(1000) }] };
    expect(qoderBodyBytes(body)).toBe(Buffer.byteLength(JSON.stringify(body), "utf8"));
  });

  it("passes a string body through unchanged", () => {
    expect(qoderBodyBytes("abcd")).toBe(4);
  });

  it("returns 0 for a missing body instead of throwing", () => {
    expect(qoderBodyBytes(null)).toBe(0);
    expect(qoderBodyBytes(undefined)).toBe(0);
  });
});

describe("qoderGrpcSessionId", () => {
  it("is stable per account and model", () => {
    expect(qoderGrpcSessionId("u1", "dmodel")).toBe(qoderGrpcSessionId("u1", "dmodel"));
  });

  it("differs across accounts and across models", () => {
    expect(qoderGrpcSessionId("u1", "dmodel")).not.toBe(qoderGrpcSessionId("u2", "dmodel"));
    expect(qoderGrpcSessionId("u1", "dmodel")).not.toBe(qoderGrpcSessionId("u1", "gmodel"));
  });

  it("is 32 hex characters, the shape the client sends", () => {
    expect(qoderGrpcSessionId("u1", "dmodel")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildQoderGrpcRequest", () => {
  const body = {
    model: "dmodel",
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
    max_tokens: 512,
    temperature: 0.3,
    reasoning_effort: "high",
    stream: true,
  };

  it("maps messages onto the proto message shape, keeping roles verbatim", () => {
    const req = buildQoderGrpcRequest("dmodel", body, { userId: "u1" });
    expect(req.model).toBe("dmodel");
    expect(req.messages).toEqual([
      { role: "system", text_content: "You are a coding agent." },
      { role: "user", text_content: "hello" },
      { role: "assistant", text_content: "hi" },
    ]);
  });

  it("flattens block-array content into text_content", () => {
    const req = buildQoderGrpcRequest(
      "dmodel",
      { messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] },
      { userId: "u1" },
    );
    expect(req.messages[0].text_content).toBe("a\nb");
  });

  it("asks for a streamed response with usage, using the proto's own shapes", () => {
    const req = buildQoderGrpcRequest("dmodel", body, { userId: "u1" });
    // proto: `bool stream = 6;` — a plain bool, not a wrapper message
    expect(req.stream).toBe(true);
    // proto: `StreamOptions stream_options = 20;` whose `include_usage` is a BoolValue
    expect(req.stream_options).toEqual({ include_usage: { value: true } });
    // proto: `google.protobuf.Int32Value max_tokens = 5;`
    expect(req.max_tokens).toEqual({ value: 512 });
    // proto: `google.protobuf.DoubleValue temperature = 3;`
    expect(req.temperature).toEqual({ value: 0.3 });
  });

  it("carries a stable session id and a fresh request id", () => {
    const a = buildQoderGrpcRequest("dmodel", body, { userId: "u1" });
    const b = buildQoderGrpcRequest("dmodel", body, { userId: "u1" });
    expect(a.metadata.context.session_id).toBe(b.metadata.context.session_id);
    expect(a.metadata.context.request_id).not.toBe(b.metadata.context.request_id);
    expect(a.metadata.context.request_set_id).not.toBe(b.metadata.context.request_set_id);
    expect(a.metadata.context.client_type).toBe("5");
    expect(a.metadata.context.task_id).toBe("common");
  });

  it("identifies the caller as the CLI agent the gateway expects", () => {
    const req = buildQoderGrpcRequest("dmodel", body, { userId: "u1" });
    expect(req.metadata.business).toMatchObject({ product: "cli", type: "agent" });
    expect(req.metadata.user).toEqual({ user_id: "u1" });
  });

  it("maps reasoning_effort onto the proto enum", () => {
    expect(buildQoderGrpcRequest("dmodel", body, { userId: "u1" }).reasoning).toEqual({
      effort: "REASONING_EFFORT_HIGH",
    });
    expect(
      buildQoderGrpcRequest("dmodel", { ...body, reasoning_effort: "max" }, { userId: "u1" }).reasoning,
    ).toEqual({ effort: "REASONING_EFFORT_MAX" });
    expect(
      buildQoderGrpcRequest("dmodel", { ...body, reasoning_effort: "none" }, { userId: "u1" }).reasoning,
    ).toEqual({ effort: "REASONING_EFFORT_NONE" });
  });

  it("omits reasoning when the caller set no effort", () => {
    const req = buildQoderGrpcRequest("dmodel", { messages: body.messages }, { userId: "u1" });
    expect(req.reasoning).toBeUndefined();
  });

  it("maps OpenAI tools onto the proto Tool shape, converting the schema to a Struct", () => {
    const req = buildQoderGrpcRequest(
      "dmodel",
      {
        messages: body.messages,
        tools: [
          {
            type: "function",
            function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
          },
        ],
      },
      { userId: "u1" },
    );
    expect(req.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: { value: "Read a file" },
          // google.protobuf.Struct: `fields`, each a Value with a `kind` oneof.
          // A raw JSON object here is silently dropped by the serializer.
          parameters: {
            fields: {
              type: { kind: "stringValue", stringValue: "object" },
              properties: { kind: "structValue", structValue: { fields: {} } },
            },
          },
        },
      },
    ]);
  });

  it("passes no tools array when the caller declared none", () => {
    const req = buildQoderGrpcRequest("dmodel", { messages: body.messages }, { userId: "u1" });
    expect(req.tools).toBeUndefined();
  });
});

describe("struct conversion (google.protobuf.Struct <-> JSON)", () => {
  it("round-trips nested JSON through Struct and back", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string", description: "file" }, limit: { type: "number" } },
      required: ["path"],
      additionalProperties: false,
    };
    expect(structToJson(jsonToStruct(schema))).toEqual(schema);
  });

  it("converts a decoded tool-call Struct into the OpenAI tool_call shape", () => {
    const decoded = jsonToStruct({
      id: "call_1",
      type: "function",
      function: { name: "read_file", arguments: { path: "/tmp/a" } },
    });
    expect(structToJson(decoded)).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "read_file", arguments: { path: "/tmp/a" } },
    });
  });

  it("keeps arrays and nulls intact", () => {
    expect(valueToJson(jsonToValue([1, "a", null, true]))).toEqual([1, "a", null, true]);
  });
});

describe("qoderGrpcMetadataValues", () => {
  const auth = { token: "dt-test-token", userId: "u1", machineId: "machine-1" };

  it("sends the same Bearer credential the COSY path uses", () => {
    expect(qoderGrpcMetadataValues(auth, "dmodel").authorization).toBe("Bearer dt-test-token");
  });

  it("sends the client identity headers the desktop client sends", () => {
    const md = qoderGrpcMetadataValues(auth, "dmodel");
    expect(md["cosy-clienttype"]).toBe("5");
    expect(md["cosy-machinetype"]).toBe("5");
    expect(md["cosy-machinetoken"]).toBe("machine-1");
    expect(md["cosy-machineos"]).toBeTruthy();
    expect(md["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(md["x-session-id"]).toBe(qoderGrpcSessionId("u1", "dmodel"));
  });
});

describe("mapGrpcStatusToHttp", () => {
  it("maps an unauthenticated status to 401 so the dashboard asks to reconnect", () => {
    expect(mapGrpcStatusToHttp(16, "unauthenticated")).toEqual({ status: 401, retryable: false });
  });

  it("maps a payload-too-large detail to 413", () => {
    expect(mapGrpcStatusToHttp(13, "Upstream error 413").status).toBe(413);
  });

  it("maps a quota refusal to 429", () => {
    expect(mapGrpcStatusToHttp(13, "quota exceeded").status).toBe(429);
  });

  it("maps an unavailable status to a retryable 502", () => {
    expect(mapGrpcStatusToHttp(14, "unavailable")).toEqual({ status: 502, retryable: true });
  });

  it("maps an unknown status to a non-retryable 502", () => {
    expect(mapGrpcStatusToHttp(2, "unknown")).toEqual({ status: 502, retryable: false });
  });
});

describe("translateGrpcChunk", () => {
  it("turns a text delta into an OpenAI chat.completion.chunk", () => {
    const chunk = {
      id: "cmpl-1",
      model: "dmodel",
      created: "1700000000",
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "" }],
    };
    const out = translateGrpcChunk(chunk, "dmodel");
    expect(out).toMatchObject({ object: "chat.completion.chunk", model: "dmodel" });
    expect(out.choices[0].delta).toEqual({ role: "assistant", content: "ok" });
    expect(out.choices[0].finish_reason).toBeNull();
  });

  it("forwards reasoning_content as a delta field", () => {
    const out = translateGrpcChunk(
      { choices: [{ index: 0, delta: { reasoning_content: "thinking" }, finish_reason: "" }] },
      "dmodel",
    );
    expect(out.choices[0].delta.reasoning_content).toBe("thinking");
  });

  it("keeps a real finish_reason and drops a chunk that carries neither text nor a finish", () => {
    const stop = translateGrpcChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, "dmodel");
    expect(stop.choices[0].finish_reason).toBe("stop");
    // Empty delta + empty finish_reason is a metadata-only frame: nothing a
    // client can act on, so it is not forwarded at all.
    expect(translateGrpcChunk({ choices: [{ index: 0, delta: {}, finish_reason: "" }] }, "dmodel")).toBeNull();
  });

  it("attaches usage when the chunk carries it", () => {
    const out = translateGrpcChunk(
      {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      "dmodel",
    );
    expect(out.usage).toEqual({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
  });

  it("returns null for a chunk with nothing to forward", () => {
    expect(translateGrpcChunk({ choices: [] }, "dmodel")).toBeNull();
  });
});

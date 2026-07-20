import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args)
}));

const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");

const encoder = new TextEncoder();
const credentials = {
  accessToken: "test-token",
  providerSpecificData: { kiroToolCallRepair: true }
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeHeader(name, value) {
  const nameBytes = encoder.encode(name);
  const valueBytes = encoder.encode(value);
  const bytes = new Uint8Array(1 + nameBytes.length + 3 + valueBytes.length);
  let offset = 0;
  bytes[offset++] = nameBytes.length;
  bytes.set(nameBytes, offset);
  offset += nameBytes.length;
  bytes[offset++] = 7;
  new DataView(bytes.buffer).setUint16(offset, valueBytes.length, false);
  offset += 2;
  bytes.set(valueBytes, offset);
  return bytes;
}

function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function frameFromEntries(entries, payload) {
  const headers = concat(entries.map(([name, value]) => encodeHeader(name, value)));
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const totalLength = 12 + headers.byteLength + payloadBytes.byteLength + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.byteLength, false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.byteLength);
  return checksum(frame);
}

function frame(eventType, payload) {
  return frameFromEntries([[":event-type", eventType]], payload);
}

function checksum(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, crc32(bytes.subarray(0, 8)), false);
  view.setUint32(bytes.byteLength - 4, crc32(bytes.subarray(0, bytes.byteLength - 4)), false);
  return bytes;
}

function response(frames, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const value of frames) controller.enqueue(value);
      controller.close();
    }
  }), { status, statusText: status === 200 ? "OK" : "Upstream Error" });
}

function controlledResponse(frames = []) {
  let controller;
  const value = new Response(new ReadableStream({
    start(streamController) {
      controller = streamController;
      for (const item of frames) controller.enqueue(item);
    }
  }), { status: 200 });
  return {
    value,
    enqueue(item) {
      controller.enqueue(item);
    },
    close() {
      controller.close();
    }
  };
}

async function text(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

async function execute(executor = new KiroExecutor(), overrides = {}) {
  return executor.execute({
    model: "kr/claude-opus-4.8",
    body: { systemPrompt: "base", conversationState: {} },
    stream: true,
    credentials,
    ...overrides
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
  delete process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS;
  delete process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS;
});

afterEach(() => {
  delete process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
  delete process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS;
  delete process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS;
});

describe("Kiro terminal integrity recovery", () => {
  it("keeps semantic output private behind a heartbeat until clean EOF", async () => {
    const upstream = controlledResponse([
      frame("assistantResponseEvent", { content: "private until validated" })
    ]);
    fetchMock.mockResolvedValueOnce(upstream.value);

    const result = await execute();
    const reader = result.response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": kiro-validation\n\n");

    let settled = false;
    const semantic = reader.read().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    upstream.close();
    expect(new TextDecoder().decode((await semantic).value)).toContain("private until validated");
    await reader.cancel();
  });

  it("accepts CLI-compatible text and usage frames at clean EOF without messageStop", async () => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "Complete answer." }),
      frame("meteringEvent", { usage: 2, unit: "credit" }),
      frame("contextUsageEvent", { contextUsagePercentage: 10 })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("Complete answer.");
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('"kiro_credits":2');
  });

  it("parses frames split across chunks and multiple frames in one chunk", async () => {
    const first = frame("assistantResponseEvent", { content: "split " });
    const second = frame("assistantResponseEvent", { content: "boundaries" });
    const combined = concat([first, second]);
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(combined.slice(0, 9));
        controller.enqueue(combined.slice(9, first.byteLength + 5));
        controller.enqueue(combined.slice(first.byteLength + 5));
        controller.close();
      }
    })));

    const body = await (await execute()).response.text();

    expect(body).toContain('"content":"split "');
    expect(body).toContain('"content":"boundaries"');
    expect(body).toContain('"finish_reason":"stop"');
  });

  it("accepts messageStop without semantic output as explicit completion", async () => {
    fetchMock.mockResolvedValueOnce(response([frame("messageStopEvent", {})]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).not.toContain("kiro_missing_terminal");
  });

  it.each(["...", "…"])("repairs exact ellipsis final %s without leaking it", async (ellipsis) => {
    fetchMock
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: ellipsis })]))
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: "Recovered answer." })]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Recovered answer.");
    expect(body).not.toContain(`"content":"${ellipsis}"`);
  });

  it.each([
    "接下來我只再確認部署結果。",
    "我會重新抓取最新日誌並確認結果。",
    "目前證據顯示只在 **03:48:30–03:49:00 TPE** 出現少量 NonKA 504；主池 106/106、副池 50/50，且兩池都沒有重啟。最後補查 504 access log，確認 host／路徑與是否為集中流量。",
    "Next I'll verify the deployment logs.",
    "Let me check the remaining failures."
  ])("repairs conservative future-action final: %s", async (progress) => {
    fetchMock
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: progress })]))
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: "Verification completed." })]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Verification completed.");
    expect(body).not.toContain(progress);
  });

  it.each([
    "Working...",
    "I'll check the logs. They show no errors and deployment succeeded.",
    "Let me check: status is 200 and the checksum matches abc123.",
    "我會檢查版本。版本是 1.2.3。",
    "接下來請你先批准部署，我會等待你的確認。",
    "已完成驗證，所有測試均通過。",
    "目前證據顯示只有少量 504，且主副池均未重啟。",
    "目前證據顯示只有少量 504。最後補查結果顯示沒有集中流量。",
    "目前證據顯示只有少量 504。最後補查，結果顯示沒有集中流量。",
    "目前證據顯示只有少量 504。最後補查：結果顯示沒有集中流量。",
    "目前證據顯示只有少量 504。最後補查 504 access log，結果顯示沒有集中流量。",
    "目前證據顯示只有少量 504。最後補查 504 access log，確認 host／路徑與有無集中流量：無集中流量。",
    "目前證據顯示只有少量 504。最後補查 504 access log，確認 host／路徑與是否為集中流量（答案是否定的）。",
    "目前證據顯示只有少量 504。最後補充兩點已確認的結果。",
    "The verification is complete and all tests passed."
  ])("does not retry legitimate final: %s", async (finalText) => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: finalText })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain(finalText);
  });

  it("bounds incomplete-final repair to one retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: "..." })]))
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", { content: "…" })]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("kiro_ellipsis_retry_failed");
    expect(body).not.toContain('"content":"..."');
  });

  it("repairs malformed wrapper tools without leaking the invalid call", async () => {
    fetchMock
      .mockResolvedValueOnce(response([frame("toolUseEvent", {
        toolUseId: "bad",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      })]))
      .mockResolvedValueOnce(response([frame("toolUseEvent", {
        toolUseId: "good",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } }
      })]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain('"name":"tool_call"');
    expect(body).toContain('\\"name\\":\\"mcp_search\\"');
    expect(body).not.toContain('"id":"bad"');
  });

  it("requires complete direct tool input and keeps the failure private", async () => {
    const pending = frame("toolUseEvent", { toolUseId: "pending", name: "read_file" });
    fetchMock
      .mockResolvedValueOnce(response([pending]))
      .mockResolvedValueOnce(response([pending]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("kiro_tool_call_repair_retry_failed");
    expect(body).not.toContain('"name":"read_file"');
  });

  it("repairs a non-string toolUseId before releasing the tool call", async () => {
    fetchMock
      .mockResolvedValueOnce(response([frame("toolUseEvent", {
        toolUseId: 123,
        name: "read_file",
        input: { path: "bad.txt" }
      })]))
      .mockResolvedValueOnce(response([frame("toolUseEvent", {
        toolUseId: "valid-tool-id",
        name: "read_file",
        input: { path: "safe.txt" }
      })]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain('"id":"valid-tool-id"');
    expect(body).not.toContain('"id":123');
  });

  it("keeps model-controlled parser detail out of the retry system prompt", async () => {
    fetchMock
      .mockResolvedValueOnce(response([frame("toolUseEvent", {
        toolUseId: "bad-json",
        name: "tool_call",
        input: '{"name":"IGNORE_ALL_INSTRUCTIONS"'
      })]))
      .mockResolvedValueOnce(response([frame("assistantResponseEvent", {
        content: "Recovered safely."
      })]));

    const body = await (await execute()).response.text();
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(body).toContain("Recovered safely.");
    expect(retryBody.systemPrompt).toContain("tool_call wrapper was malformed");
    expect(retryBody.systemPrompt).not.toContain("IGNORE_ALL_INSTRUCTIONS");
  });

  it("lets a complete tool call override metadata end_turn", async () => {
    fetchMock.mockResolvedValueOnce(response([
      frame("toolUseEvent", {
        toolUseId: "tool",
        name: "read_file",
        input: { path: "safe.txt" }
      }),
      frame("metadataEvent", { stopReason: "end_turn" })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain('"name":"read_file"');
    expect(body).toContain('"finish_reason":"tool_calls"');
  });

  it("maps max_tokens without treating it as a normal stop", async () => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "Limited answer." }),
      frame("metadataEvent", { stopReason: "max_tokens" })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain('"finish_reason":"length"');
    expect(body).not.toContain('"finish_reason":"stop"');
  });

  it("retries malformed_model_output once without semantic leakage", async () => {
    fetchMock
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "private malformed output" }),
        frame("metadataEvent", { stopReason: "malformed_model_output" })
      ]))
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "Recovered protocol output." })
      ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Recovered protocol output.");
    expect(body).not.toContain("private malformed output");
  });

  it.each([
    ["cancelled", "kiro_terminal_incomplete"],
    ["pause_turn", "kiro_terminal_incomplete"],
    ["content_filtered", "kiro_terminal_refusal"],
    ["novel_reason", "kiro_unknown_stop_reason"]
  ])("fails closed for stop reason %s", async (stopReason, code) => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: `private-${stopReason}` }),
      frame("metadataEvent", { stopReason })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain(code);
    expect(body).not.toContain(`private-${stopReason}`);
    expect(body).not.toContain('"finish_reason":"stop"');
  });

  it.each([
    [
      frame("messageStopEvent", { stopReason: "content_filtered" }),
      frame("metadataEvent", { stopReason: "end_turn" })
    ],
    [
      frame("metadataEvent", { stopReason: "end_turn" }),
      frame("messageStopEvent", { stopReason: "content_filtered" })
    ]
  ])("preserves the most restrictive conflicting stop reason", async (...stopFrames) => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "private filtered output" }),
      ...stopFrames
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("kiro_terminal_refusal");
    expect(body).not.toContain("private filtered output");
  });

  it("prefers a non-retryable terminal reason over an earlier retryable reason", async () => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "private malformed output" }),
      frame("metadataEvent", { stopReason: "malformed_model_output" }),
      frame("messageStopEvent", { stopReason: "cancelled" })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("kiro_terminal_incomplete");
    expect(body).toContain('"stop_reason":"cancelled"');
    expect(body).not.toContain("private malformed output");
  });

  it("preserves an authoritative refusal returned by the bounded retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "private filtered retry" }),
        frame("metadataEvent", { stopReason: "content_filtered" })
      ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("kiro_terminal_refusal");
    expect(body).not.toContain("kiro_missing_terminal_retry_failed");
    expect(body).not.toContain("private filtered retry");
  });

  it.each([
    ["max_tokens", "kiro_terminal_incomplete"],
    ["cancelled", "kiro_terminal_incomplete"],
    ["content_filtered", "kiro_terminal_refusal"],
    ["novel_reason", "kiro_unknown_stop_reason"]
  ])("does not let a valid tool override failure stop reason %s", async (stopReason, code) => {
    fetchMock.mockResolvedValueOnce(response([
      frame("toolUseEvent", {
        toolUseId: "blocked-tool",
        name: "read_file",
        input: { path: "secret.txt" }
      }),
      frame("metadataEvent", { stopReason })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain(code);
    expect(body).not.toContain('"name":"read_file"');
  });

  it.each(["content_filtered", "cancelled", "max_tokens"])(
    "classifies failure %s before validating a malformed deferred tool",
    async (stopReason) => {
      fetchMock.mockResolvedValueOnce(response([
        frame("toolUseEvent", { toolUseId: "bad-tool", name: "read_file" }),
        frame("metadataEvent", { stopReason })
      ]));

      const body = await (await execute()).response.text();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body).toContain(stopReason === "content_filtered"
        ? "kiro_terminal_refusal"
        : "kiro_terminal_incomplete");
      expect(body).not.toContain("kiro_tool_call_repair_retry_failed");
      expect(body).not.toContain('"name":"read_file"');
    }
  );

  it.each([
    ["content_filtered", [frame("toolUseEvent", {
      toolUseId: 123,
      name: "read_file",
      input: { path: "bad.txt" }
    })], "kiro_terminal_refusal"],
    ["cancelled", [frame("toolUseEvent", {
      toolUseId: "missing-name",
      input: { path: "bad.txt" }
    })], "kiro_terminal_incomplete"],
    ["max_tokens", [
      frame("toolUseEvent", { toolUseId: "changing", name: "read_file" }),
      frame("toolUseEvent", { toolUseId: "changing", name: "write_file" })
    ], "kiro_terminal_incomplete"]
  ])("continues past eager tool-shape errors to authoritative stop %s", async (stopReason, toolFrames, code) => {
    fetchMock.mockResolvedValueOnce(response([
      ...toolFrames,
      frame("metadataEvent", { stopReason })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain(code);
    expect(body).not.toContain("kiro_tool_call_repair_retry_failed");
    expect(body).not.toContain('"tool_calls"');
  });

  it("retries a TTFT timeout once while preserving cancellation semantics", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "1";
    fetchMock
      .mockResolvedValueOnce(controlledResponse().value)
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "Recovered after timeout." })
      ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Recovered after timeout.");
  });

  it("treats validated non-semantic frames as watchdog activity", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "30";
    process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "30";
    const upstream = controlledResponse();
    fetchMock.mockResolvedValueOnce(upstream.value);
    setTimeout(() => upstream.enqueue(frame("meteringEvent", { usage: 1 })), 20);
    setTimeout(() => upstream.enqueue(frame("contextUsageEvent", { contextUsagePercentage: 5 })), 40);
    setTimeout(() => {
      upstream.enqueue(frame("assistantResponseEvent", { content: "Completed after active frames." }));
      upstream.close();
    }, 60);

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("Completed after active frames.");
  });

  it("retries a response-body read failure once", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error("socket reset"));
        }
      })))
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "Recovered after read failure." })
      ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Recovered after read failure.");
    expect(body).not.toContain("socket reset");
  });

  it.each([
    ["message CRC", () => {
      const corrupt = frame("assistantResponseEvent", { content: "corrupt CRC" });
      corrupt[corrupt.byteLength - 1] ^= 0xff;
      return [corrupt];
    }],
    ["prelude CRC", () => {
      const corrupt = frame("assistantResponseEvent", { content: "corrupt prelude" });
      corrupt[8] ^= 0xff;
      return [corrupt];
    }],
    ["truncated frame", () => {
      const truncated = frame("assistantResponseEvent", { content: "truncated" });
      return [truncated.slice(0, -3)];
    }],
    ["out-of-bounds headers", () => {
      const corrupt = frame("assistantResponseEvent", { content: "bad headers" });
      new DataView(corrupt.buffer).setUint32(4, corrupt.byteLength - 15, false);
      return [checksum(corrupt)];
    }],
    ["duplicate headers", () => [
      frameFromEntries([
        [":event-type", "assistantResponseEvent"],
        [":event-type", "metadataEvent"]
      ], { content: "duplicate" })
    ]]
  ])("retries %s and releases only the valid attempt", async (_name, invalidFrames) => {
    fetchMock
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "must stay private" }),
        ...invalidFrames()
      ]))
      .mockResolvedValueOnce(response([
        frame("assistantResponseEvent", { content: "Recovered after validation." })
      ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toContain("Recovered after validation.");
    expect(body).not.toContain("must stay private");
  });

  it("reports corrupt-frame provenance when the bounded retry also fails", async () => {
    const corruptFrame = () => {
      const corrupt = frame("assistantResponseEvent", { content: "corrupt" });
      corrupt[corrupt.byteLength - 1] ^= 0xff;
      return corrupt;
    };
    fetchMock
      .mockResolvedValueOnce(response([corruptFrame()]))
      .mockResolvedValueOnce(response([corruptFrame()]));

    const body = await (await execute()).response.text();

    expect(body).toContain("kiro_missing_terminal_retry_failed");
    expect(body).toContain('"terminal_provenance":"corrupt_eventstream_frame"');
    expect(body).toContain('"transport_state":"corrupt_frame"');
  });

  it("caps diagnostic event-type cardinality", async () => {
    let terminal;
    const executor = new KiroExecutor();
    const frames = Array.from({ length: 100 }, (_, index) =>
      frame(`unknownEvent${index}`, { index })
    );
    frames.push(frame("assistantResponseEvent", { content: "done" }));
    const transformed = executor.transformEventStreamToSSE(
      response(frames),
      "kr/claude-opus-4.8",
      { onTerminalState: (value) => { terminal = value; } }
    );

    await transformed.text();

    expect(terminal.event_counts).toEqual({
      other: 100,
      assistantResponseEvent: 1
    });
  });

  it("rejects a raw chunk before concatenating beyond the protocol bound", async () => {
    let terminal;
    const executor = new KiroExecutor();
    const transformed = executor.transformEventStreamToSSE(
      response([new Uint8Array(65)]),
      "kr/claude-opus-4.8",
      {
        maxRawBytes: 64,
        onTerminalState: (value) => { terminal = value; }
      }
    );

    const body = await transformed.text();

    expect(body).toContain("buffered bytes exceed the protocol bound");
    expect(terminal.terminal_provenance).toBe("corrupt_eventstream_frame");
  });

  it.each(["error", "exception"])("propagates EventStream %s without retry or leakage", async (messageType) => {
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "must stay private" }),
      frameFromEntries([
        [":message-type", messageType],
        ...(messageType === "exception" ? [[":exception-type", "InternalServerException"]] : [])
      ], { message: "upstream failed" })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("kiro_upstream_eventstream_error");
    expect(body).toContain("upstream failed");
    expect(body).not.toContain("must stay private");
  });

  it("surfaces retry HTTP failures as SSE after heartbeat commits headers", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(new Response("unauthorized", {
        status: 401,
        statusText: "Unauthorized"
      }));

    const result = await execute();
    const body = await result.response.text();

    expect(result.response.status).toBe(200);
    expect(body).toContain("kiro_integrity_retry_upstream_error");
    expect(body).toContain("unauthorized");
  });

  it("bounds the retry HTTP error body", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(new Response(`error-start-${"x".repeat(10_000)}-error-tail`, {
        status: 401,
        statusText: "Unauthorized"
      }));

    const body = await (await execute()).response.text();

    expect(body).toContain("error-start-");
    expect(body).not.toContain("error-tail");
    expect(body.length).toBeLessThan(5000);
  });

  it("propagates cancellation while validation is waiting for EOF", async () => {
    const upstream = controlledResponse([
      frame("assistantResponseEvent", { content: "waiting" })
    ]);
    fetchMock.mockResolvedValueOnce(upstream.value);
    const abort = new AbortController();

    const result = await execute(new KiroExecutor(), { signal: abort.signal });
    const reader = result.response.body.getReader();
    await reader.read();
    abort.abort("client cancelled");

    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails safely when the private gate exceeds its configured bound", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = "8";
    fetchMock.mockResolvedValueOnce(response([
      frame("assistantResponseEvent", { content: "larger than eight bytes" })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("integrity buffer exceeded");
    expect(body).not.toContain("larger than eight bytes");
  });

  it("counts deferred tool fragments against the private memory bound", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = "128";
    fetchMock.mockResolvedValueOnce(response([
      frame("toolUseEvent", {
        toolUseId: "large-tool",
        name: "read_file",
        input: { path: "x".repeat(200) }
      })
    ]));

    const body = await (await execute()).response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("kiro_integrity_buffer_exceeded");
    expect(body).not.toContain('"name":"read_file"');
  });
});

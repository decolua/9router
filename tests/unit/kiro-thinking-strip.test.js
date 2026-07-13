import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import "../translator/registerAll.js";

function createMockFrame(eventType, payloadObj) {
  const payloadStr = JSON.stringify(payloadObj);
  const payloadBytes = new TextEncoder().encode(payloadStr);

  const headerName = ":event-type";
  const headerNameBytes = new TextEncoder().encode(headerName);
  const headerValueBytes = new TextEncoder().encode(eventType);

  // nameLen(1) + name + type(1) + valueLen(2) + value
  const headerLength = 1 + headerNameBytes.length + 1 + 2 + headerValueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);

  let offset = 12;
  buffer[offset++] = headerNameBytes.length;
  buffer.set(headerNameBytes, offset);
  offset += headerNameBytes.length;

  buffer[offset++] = 7; // String type
  view.setUint16(offset, headerValueBytes.length, false);
  offset += 2;
  buffer.set(headerValueBytes, offset);
  offset += headerValueBytes.length;

  buffer.set(payloadBytes, offset);
  
  return buffer;
}

async function readAllSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

async function readNextWithTimeout(reader) {
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE chunk")), 100)),
  ]);
}

describe("KiroExecutor thinking tag stripping", () => {
  it("strips <thinking> tags from assistantResponseEvent", async () => {
    const executor = new KiroExecutor();
    
    // Create frames
    const f1 = createMockFrame("assistantResponseEvent", { content: "Here is my answer. <thinking>Let me think..." });
    const f2 = createMockFrame("assistantResponseEvent", { content: "still thinking...</thinking> Yes, 42." });
    
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.close();
      }
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(mockResponse, "claude-test");
    
    const output = await readAllSSE(transformedResponse.body);
    
    // Check that we got chat.completion.chunk outputs
    expect(output).toContain("chat.completion.chunk");
    // Ensure the thinking parts are gone
    expect(output).not.toContain("<thinking>");
    expect(output).not.toContain("Let me think...");
    expect(output).not.toContain("still thinking...");
    expect(output).not.toContain("</thinking>");
    
    // Check that the normal content is preserved
    // Parse the data chunks
    const dataLines = output.split("\n").filter(line => line.startsWith("data: "));
    const contents = dataLines.map(line => {
      if (line.includes("[DONE]")) return "";
      try {
        return JSON.parse(line.slice(6)).choices[0].delta.content || "";
      } catch {
        return "";
      }
    });
    
    const fullText = contents.join("");
    expect(fullText).toBe("Here is my answer.  Yes, 42.");
  });

  it("handles empty content after stripping when hasReasoningContent is true", async () => {
    const executor = new KiroExecutor();
    
    const f0 = createMockFrame("reasoningContentEvent", { text: "I am reasoning" });
    const f1 = createMockFrame("assistantResponseEvent", { content: "<thinking>purely thinking...</thinking>" });
    
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f0);
        controller.enqueue(f1);
        controller.close();
      }
    });

    const mockResponse = { body: readableStream };
    const transformedResponse = executor.transformEventStreamToSSE(mockResponse, "claude-test");
    
    const output = await readAllSSE(transformedResponse.body);
    
    const dataLines = output.split("\n").filter(line => line.startsWith("data: ") && !line.includes("[DONE]"));
    const objects = dataLines.map(line => JSON.parse(line.slice(6)));
    
    // First chunk should have reasoning_content
    expect(objects[0].choices[0].delta.reasoning_content).toBe("I am reasoning");
    
    // We shouldn't get an empty content chunk from f1 since it was entirely stripped and reasoning was present
    const contentChunks = objects.filter(obj => obj.choices[0].delta.content !== undefined);
    expect(contentChunks.length).toBe(0);
  });

  it("surfaces Kiro meteringEvent credit usage on the final chunk", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("meteringEvent", { usage: 0.0097, unit: "credit", unitPlural: "credits" });
    const f3 = createMockFrame("contextUsageEvent", { contextUsagePercentage: 1 });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.enqueue(f3);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.find(obj => obj.usage?.kiro_credits !== undefined);
    expect(finalChunk.usage.kiro_credits).toBe(0.0097);
    expect(finalChunk.usage.kiro_credit_unit).toBe("credit");
    expect(finalChunk.kiro_metering).toBeUndefined();

    const clientChunk = translateResponse(FORMATS.KIRO, FORMATS.OPENAI, finalChunk, {});
    expect(clientChunk.usage).toBeUndefined();
  });

  it("surfaces Kiro metering usage even without token metrics or context usage", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("meteringEvent", { usage: 0.0042, unit: "credit", unitPlural: "credits" });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.find(obj => obj.usage?.kiro_credits !== undefined);
    expect(finalChunk.usage).toMatchObject({
      kiro_credits: 0.0042,
      kiro_credit_unit: "credit",
    });
    expect(finalChunk.usage.prompt_tokens).toBeUndefined();
    expect(finalChunk.usage.completion_tokens).toBeUndefined();
    expect(finalChunk.usage.total_tokens).toBeUndefined();
  });

  it("keeps Kiro metering when context usage arrives before metering", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("contextUsageEvent", { contextUsagePercentage: 1 });
    const f3 = createMockFrame("meteringEvent", { usage: 0.0088, unit: "credit", unitPlural: "credits" });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.enqueue(f3);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.find(obj => obj.usage?.kiro_credits !== undefined);
    expect(finalChunk.usage.kiro_credits).toBe(0.0088);
  });

  it("keeps Kiro metering when messageStop arrives before metering", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("messageStopEvent", {});
    const f3 = createMockFrame("meteringEvent", { usage: 0.0061, unit: "credit", unitPlural: "credits" });
    const f4 = createMockFrame("metricsEvent", { inputTokens: 12, outputTokens: 3 });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
        controller.enqueue(f3);
        controller.enqueue(f4);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.find(obj => obj.choices?.[0]?.finish_reason === "stop");
    expect(finalChunk.usage).toBeUndefined();
    const usageChunk = objects.find(obj => obj.usage?.kiro_credits !== undefined);
    expect(usageChunk.usage.kiro_credits).toBe(0.0061);

    let usage = null;
    for (const obj of objects) {
      usage = mergeUsage(usage, extractUsage(obj));
    }
    expect(usage.kiro_credits).toBe(0.0061);
    expect(usage.prompt_tokens).toBe(12);
    expect(usage.completion_tokens).toBe(3);
  });

  it("does not forward duplicate public token usage after a final OpenAI chunk already carried it", () => {
    const state = {};
    const [finishChunk] = translateResponse(FORMATS.KIRO, FORMATS.OPENAI, {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }, state);
    expect(finishChunk.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });

    const [lateUsageChunk] = translateResponse(FORMATS.KIRO, FORMATS.OPENAI, {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, kiro_credits: 0.1, kiro_credit_unit: "credit" },
    }, state);

    expect(lateUsageChunk.usage).toBeUndefined();
  });

  it("emits a terminal chunk at messageStop before the upstream stream closes", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("messageStopEvent", {});

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.enqueue(f2);
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const reader = transformedResponse.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    for (let i = 0; i < 4 && !output.includes("\"finish_reason\":\"stop\""); i++) {
      const { value } = await readNextWithTimeout(reader);
      output += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    expect(output).toContain("\"finish_reason\":\"stop\"");
  });

  it("uses tool_calls finish reason for tool streams without messageStop", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("toolUseEvent", { toolUseId: "tool-1", name: "read_file", input: { path: "a.txt" } });

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(f1);
        controller.close();
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const output = await readAllSSE(transformedResponse.body);
    const objects = output
      .split("\n")
      .filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));

    const finalChunk = objects.at(-1);
    expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
  });
});

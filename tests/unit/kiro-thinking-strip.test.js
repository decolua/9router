import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
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

  view.setUint32(8, crc32(buffer.subarray(0, 8)), false);
  view.setUint32(totalLength - 4, crc32(buffer.subarray(0, totalLength - 4)), false);
  return buffer;
}

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

  it("waits for clean EOF before emitting stop after messageStop", async () => {
    const executor = new KiroExecutor();

    const f1 = createMockFrame("assistantResponseEvent", { content: "OK" });
    const f2 = createMockFrame("messageStopEvent", {});

    let upstreamController;
    const readableStream = new ReadableStream({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(f1);
        controller.enqueue(f2);
      }
    });

    const transformedResponse = executor.transformEventStreamToSSE({ body: readableStream }, "claude-test");
    const reader = transformedResponse.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const { value } = await readNextWithTimeout(reader);
    output += decoder.decode(value, { stream: true });
    expect(output).not.toContain("\"finish_reason\":\"stop\"");

    upstreamController.close();
    while (!output.includes("\"finish_reason\":\"stop\"")) {
      const { value: nextValue, done } = await readNextWithTimeout(reader);
      if (done) break;
      output += decoder.decode(nextValue, { stream: true });
    }

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

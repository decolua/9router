import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

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
});

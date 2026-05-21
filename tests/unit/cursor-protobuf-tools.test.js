import { describe, it, expect } from "vitest";
import {
  generateCursorBody,
  parseConnectRPCFrame,
  decodeMessage,
  decodeVarint,
} from "../../open-sse/utils/cursorProtobuf.js";

const FIELD = {
  REQUEST: 1,
  MESSAGES: 1,
  INSTRUCTION: 3,
  SUPPORTED_TOOLS: 29,
  MCP_TOOLS: 34,
  MSG_SUPPORTED_TOOLS: 51,
  INSTRUCTION_TEXT: 1,
};

function firstVarint(buffer) {
  const [value] = decodeVarint(buffer, 0);
  return value;
}

function decodeCursorRequest(frameBody) {
  const frame = parseConnectRPCFrame(frameBody);
  expect(frame).not.toBeNull();
  const top = decodeMessage(frame.payload);
  expect(top.has(FIELD.REQUEST)).toBe(true);
  const request = decodeMessage(top.get(FIELD.REQUEST)[0].value);
  return request;
}

function buildTool(name = "search_files") {
  return {
    type: "function",
    function: {
      name,
      description: "Search files",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
        required: ["pattern", "path"],
      },
    },
  };
}

describe("Cursor protobuf tool advertisement", () => {
  it("advertises OpenAI custom tools as Cursor MCP tools, not ask_question", () => {
    const body = generateCursorBody(
      [{ role: "user", content: "Use search_files" }],
      "composer-2.5-fast",
      [buildTool()],
      null,
      false
    );

    const request = decodeCursorRequest(body);

    const messages = request.get(FIELD.MESSAGES) || [];
    const firstMsg = decodeMessage(messages[0].value);
    const firstContent = new TextDecoder().decode(firstMsg.get(1)[0].value);
    expect(firstContent).toContain("OpenAI custom tools are available");
    expect(firstContent).toContain("search_files");
    expect(firstContent).toContain("｜tool▁calls▁begin｜");
    expect(firstContent).toContain("do not use or mention unavailable tools such as ask_question");

    expect(request.has(FIELD.MCP_TOOLS)).toBe(true);
    expect(request.has(FIELD.SUPPORTED_TOOLS)).toBe(true);
    expect(firstVarint(request.get(FIELD.SUPPORTED_TOOLS)[0].value)).toBe(19);

    const lastMessage = decodeMessage(messages[messages.length - 1].value);
    expect(lastMessage.has(FIELD.MSG_SUPPORTED_TOOLS)).toBe(true);
    expect(firstVarint(lastMessage.get(FIELD.MSG_SUPPORTED_TOOLS)[0].value)).toBe(19);
  });

  it("keeps ask_question only for forced agent mode without custom tools", () => {
    const body = generateCursorBody(
      [{ role: "user", content: "Continue" }],
      "composer-2.5-fast",
      [],
      null,
      true
    );

    const request = decodeCursorRequest(body);
    expect(request.has(FIELD.MCP_TOOLS)).toBe(false);
    expect(request.has(FIELD.SUPPORTED_TOOLS)).toBe(true);
    expect(firstVarint(request.get(FIELD.SUPPORTED_TOOLS)[0].value)).toBe(1);
  });
});

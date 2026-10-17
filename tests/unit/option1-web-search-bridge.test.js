import { describe, it, expect } from "vitest";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/blocks.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

// Regex matching official Anthropic server_tool_use ID format
const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

/**
 * Option 1 Grounding-to-Anthropic Bridge Reference Implementation
 * This maps Google Antigravity / Gemini groundingMetadata into official Anthropic SSE events.
 */
export function projectGroundingToAnthropicBlocks(groundingMetadata, originalQuery = "") {
  if (!groundingMetadata) return { blocks: [], usageExtra: null };

  const queries = groundingMetadata.webSearchQueries || [];
  const query = queries[0] || originalQuery || "web search";
  const chunks = groundingMetadata.groundingChunks || [];

  // Deterministic server_tool_use id matching Anthropic format
  const serverToolId = `srvtoolu_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  const searchResults = chunks.map((ch, idx) => {
    const web = ch?.web || {};
    const url = web.uri || web.url || "";
    const title = web.title || "";
    // Encrypted content token required by Anthropic multi-turn contract
    const encryptedContent = Buffer.from(JSON.stringify({ u: url, t: title, i: idx })).toString("base64");
    return {
      type: "web_search_result",
      url,
      title,
      page_age: "recently",
      encrypted_content: encryptedContent,
    };
  });

  const serverToolBlock = {
    type: CLAUDE_BLOCK.SERVER_TOOL_USE,
    id: serverToolId,
    name: "web_search",
    input: { query },
  };

  const toolResultBlock = {
    type: CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT,
    tool_use_id: serverToolId,
    content: searchResults,
  };

  return {
    serverToolBlock,
    toolResultBlock,
    usageExtra: {
      server_tool_use: {
        web_search_requests: 1,
      },
    },
  };
}

/**
 * Generates official Anthropic streaming SSE events for a grounded turn.
 */
export function* generateAnthropicGroundedSseStream({
  messageId = `msg_${Date.now()}`,
  model = "gemini-2.5-flash",
  groundingMetadata,
  textAnswer = "",
  originalQuery = "",
}) {
  yield {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 150, output_tokens: 0 },
      },
    },
  };

  let nextIndex = 0;

  if (groundingMetadata) {
    const { serverToolBlock, toolResultBlock } = projectGroundingToAnthropicBlocks(groundingMetadata, originalQuery);

    const srvToolIndex = nextIndex++;
    yield {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: srvToolIndex,
        content_block: serverToolBlock,
      },
    };
    yield {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: srvToolIndex },
    };

    const srvResultIndex = nextIndex++;
    yield {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: srvResultIndex,
        content_block: toolResultBlock,
      },
    };
    yield {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: srvResultIndex },
    };
  }

  if (textAnswer) {
    const textIndex = nextIndex++;
    yield {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: textIndex,
        content_block: { type: "text", text: "" },
      },
    };
    yield {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: textIndex,
        delta: { type: "text_delta", text: textAnswer },
      },
    };
    yield {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: textIndex },
    };
  }

  yield {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        output_tokens: 85,
        server_tool_use: {
          web_search_requests: groundingMetadata ? 1 : 0,
        },
      },
    },
  };

  yield {
    event: "message_stop",
    data: { type: "message_stop" },
  };
}

describe("Option 1: Anthropic Native web_search_20250305 ➔ Antigravity Google Grounding Bridge", () => {
  const sampleGroundingMetadata = {
    webSearchQueries: ["OpenMOSS MOSS-Image github paper"],
    groundingChunks: [
      {
        web: {
          uri: "https://github.com/OpenMOSS/MOSS-Image",
          title: "OpenMOSS/MOSS-Image: Open Multimodal Model",
        },
      },
      {
        web: {
          uri: "https://arxiv.org/abs/2405.00000",
          title: "MOSS-Image: A Comprehensive Multimodal Foundation Model",
        },
      },
    ],
    groundingSupports: [
      {
        segment: {
          startIndex: 0,
          endIndex: 40,
          text: "MOSS-Image is an open multimodal model.",
        },
        groundingChunkIndices: [0, 1],
      },
    ],
  };

  it("projects Google groundingMetadata into compliant Anthropic server tool blocks", () => {
    const { serverToolBlock, toolResultBlock, usageExtra } = projectGroundingToAnthropicBlocks(
      sampleGroundingMetadata,
      "OpenMOSS"
    );

    // 1. Verify server_tool_use block
    expect(serverToolBlock.type).toBe("server_tool_use");
    expect(serverToolBlock.name).toBe("web_search");
    expect(serverToolBlock.input).toEqual({ query: "OpenMOSS MOSS-Image github paper" });
    expect(CLAUDE_SERVER_TOOL_USE_ID.test(serverToolBlock.id)).toBe(true);

    // 2. Verify web_search_tool_result block
    expect(toolResultBlock.type).toBe("web_search_tool_result");
    expect(toolResultBlock.tool_use_id).toBe(serverToolBlock.id);
    expect(Array.isArray(toolResultBlock.content)).toBe(true);
    expect(toolResultBlock.content).toHaveLength(2);

    const firstResult = toolResultBlock.content[0];
    expect(firstResult.type).toBe("web_search_result");
    expect(firstResult.url).toBe("https://github.com/OpenMOSS/MOSS-Image");
    expect(firstResult.title).toBe("OpenMOSS/MOSS-Image: Open Multimodal Model");
    expect(typeof firstResult.encrypted_content).toBe("string");
    expect(firstResult.encrypted_content.length).toBeGreaterThan(10);

    // 3. Verify server_tool_use usage tracking
    expect(usageExtra?.server_tool_use?.web_search_requests).toBe(1);
  });

  it("emits streaming SSE events strictly adhering to Anthropic Messages protocol", () => {
    const events = [
      ...generateAnthropicGroundedSseStream({
        groundingMetadata: sampleGroundingMetadata,
        textAnswer: "Here are the MOSS-Image details.",
      }),
    ];

    const eventNames = events.map((e) => e.event);
    expect(eventNames).toEqual([
      "message_start",
      "content_block_start", // index 0: server_tool_use
      "content_block_stop",
      "content_block_start", // index 1: web_search_tool_result
      "content_block_stop",
      "content_block_start", // index 2: text
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // Verify index ordering
    const starts = events.filter((e) => e.event === "content_block_start");
    expect(starts[0].data.index).toBe(0);
    expect(starts[0].data.content_block.type).toBe("server_tool_use");
    expect(CLAUDE_SERVER_TOOL_USE_ID.test(starts[0].data.content_block.id)).toBe(true);

    expect(starts[1].data.index).toBe(1);
    expect(starts[1].data.content_block.type).toBe("web_search_tool_result");
    expect(starts[1].data.content_block.tool_use_id).toBe(starts[0].data.content_block.id);

    expect(starts[2].data.index).toBe(2);
    expect(starts[2].data.content_block.type).toBe("text");

    // Verify usage reported in message_delta
    const msgDelta = events.find((e) => e.event === "message_delta");
    expect(msgDelta.data.usage.server_tool_use.web_search_requests).toBe(1);
  });

  it("preserves Option 1 server_tool_use and result blocks across multi-turn passthrough normalization", () => {
    const validServerToolId = "srvtoolu_01AbCdEfGhIjKlMnOpQrStUv";
    const history = [
      {
        role: "user",
        content: "Search for MOSS-Image",
      },
      {
        role: "assistant",
        content: [
          {
            type: "server_tool_use",
            id: validServerToolId,
            name: "web_search",
            input: { query: "MOSS-Image" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: validServerToolId,
            content: [
              {
                type: "web_search_result",
                url: "https://github.com/OpenMOSS/MOSS-Image",
                title: "OpenMOSS",
                encrypted_content: "dGVzdA==",
              },
            ],
          },
          {
            type: "text",
            text: "Found the repository.",
          },
        ],
      },
      {
        role: "user",
        content: "Summarize the architecture",
      },
    ];

    const normalized = normalizeClaudePassthrough({ messages: history }, "claude-sonnet-5");

    // Must NOT drop the server_tool_use or web_search_tool_result blocks
    expect(normalized.messages).toHaveLength(3);
    const assistantContent = normalized.messages[1].content;
    expect(assistantContent).toHaveLength(3);
    expect(assistantContent[0].type).toBe("server_tool_use");
    expect(assistantContent[0].id).toBe(validServerToolId);
    expect(assistantContent[1].type).toBe("web_search_tool_result");
    expect(assistantContent[1].tool_use_id).toBe(validServerToolId);
    expect(assistantContent[2].type).toBe("text");
  });

  it("drops foreign server_tool_use (e.g. call_ from other providers) while keeping srvtoolu_ from Option 1", () => {
    const history = [
      {
        role: "assistant",
        content: [
          // Foreign server_tool_use with call_ id
          { type: "server_tool_use", id: "call_foreign123", name: "analyze_image", input: {} },
          // Option 1 valid server_tool_use
          { type: "server_tool_use", id: "srvtoolu_valid001", name: "web_search", input: { query: "test" } },
          { type: "text", text: "Answer text" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_foreign123", content: "foreign result" },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_valid001", content: [] },
          { type: "text", text: "Next question" },
        ],
      },
    ];

    const normalized = normalizeClaudePassthrough({ messages: history }, "claude-sonnet-5");

    // The foreign call_ block must be stripped, but srvtoolu_ must be preserved
    expect(normalized.messages[0].content).toEqual([
      { type: "server_tool_use", id: "srvtoolu_valid001", name: "web_search", input: { query: "test" } },
      { type: "text", text: "Answer text" },
    ]);

    expect(normalized.messages[1].content).toEqual([
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_valid001", content: [] },
      { type: "text", text: "Next question" },
    ]);
  });

  it("verifies live Google Antigravity search grounding returns valid groundingMetadata that transforms cleanly", async () => {
    let creds = null;
    try {
      const { getProviderConnections } = await import("@/lib/localDb.js");
      const conns = await getProviderConnections("antigravity");
      if (conns?.length > 0 && conns[0]?.accessToken) {
        creds = conns[0];
      }
    } catch {}

    if (!creds?.accessToken) {
      console.warn("No active Antigravity connection found, skipping live check");
      return;
    }

    const endpoint = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
    const body = {
      project: creds.projectId,
      model: "gemini-2.5-flash",
      userAgent: "antigravity",
      requestId: "agent/00000000-0000-0000-0000-000000000000/123456789/00000000-0000-0000-0000-000000000000/1",
      request: {
        contents: [{ role: "user", parts: [{ text: "Who won the Nobel prize in physics in 2024?" }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 500 },
        sessionId: "-84920491823901"
      }
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${creds.accessToken}`,
        "User-Agent": "antigravity/ide/2.22.0 darwin/arm64"
      },
      body: JSON.stringify(body)
    });

    expect(res.status).toBe(200);
    const raw = await res.text();
    const dataLines = raw.split("\r\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6));
    expect(dataLines.length).toBeGreaterThan(0);

    let observedGrounding = null;
    let answerText = "";
    for (const line of dataLines) {
      try {
        const chunk = JSON.parse(line);
        const resp = chunk.response || chunk;
        const cand = resp.candidates?.[0];
        if (cand?.groundingMetadata) observedGrounding = cand.groundingMetadata;
        for (const p of cand?.content?.parts || []) {
          if (p.text && !p.thought) answerText += p.text;
        }
      } catch {}
    }

    expect(observedGrounding).toBeDefined();
    expect(Array.isArray(observedGrounding.webSearchQueries)).toBe(true);
    expect(observedGrounding.webSearchQueries.length).toBeGreaterThan(0);
    expect(Array.isArray(observedGrounding.groundingChunks)).toBe(true);
    expect(observedGrounding.groundingChunks.length).toBeGreaterThan(0);

    // Transform live observed Google grounding into Anthropic SSE stream
    const sseEvents = [...generateAnthropicGroundedSseStream({
      groundingMetadata: observedGrounding,
      textAnswer: answerText,
      originalQuery: "Nobel prize in physics in 2024"
    })];

    const srvToolUse = sseEvents.find(e => e.data?.content_block?.type === "server_tool_use");
    const webResult = sseEvents.find(e => e.data?.content_block?.type === "web_search_tool_result");

    expect(srvToolUse).toBeDefined();
    expect(srvToolUse.data.content_block.name).toBe("web_search");
    expect(srvToolUse.data.content_block.input.query).toBeTruthy();

    expect(webResult).toBeDefined();
    expect(webResult.data.content_block.tool_use_id).toBe(srvToolUse.data.content_block.id);
    expect(webResult.data.content_block.content.length).toBe(observedGrounding.groundingChunks.length);
  });
});

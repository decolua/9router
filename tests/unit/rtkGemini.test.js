// Tests for Gemini / Antigravity / Gemini-CLI / Vertex format RTK support
import { describe, it, expect, vi } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function makeLongDiff() {
  const lines = [
    "diff --git a/src/app.js b/src/app.js",
    "index 1111111..2222222 100644",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -1,3 +1,180 @@",
  ];
  for (let i = 0; i < 180; i++) {
    lines.push(`+const addedLine_${i} = "DIFF_MARKER_${i}_" + "${"x".repeat(24)}";`);
  }
  return lines.join("\n");
}

describe("Gemini & Antigravity format RTK support", () => {
  it("compresses tool results in Gemini/Vertex top-level contents[]", () => {
    const diff = makeLongDiff();
    const geminiBody = {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: "Run git diff" }] },
        {
          role: "model",
          parts: [{ functionCall: { id: "call_1", name: "Bash", args: { command: "git diff" } } }],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call_1",
                name: "Bash",
                response: { result: { result: diff } },
              },
            },
          ],
        },
      ],
    };

    const stats = compressMessages(geminiBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("git-diff");
    expect(stats.hits[0].shape).toBe("gemini-tool-result");
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);

    const compressed = geminiBody.contents[2].parts[0].functionResponse.response.result.result;
    expect(compressed.length).toBeLessThan(diff.length);
    expect(compressed).toContain("lines truncated");
    expect(compressed).not.toContain("DIFF_MARKER_150_");
  });

  it("compresses tool results in Antigravity/Gemini-CLI envelope (request.contents[])", () => {
    const diff = makeLongDiff();
    const buildLines = [];
    for (let i = 1; i <= 20; i++) {
      buildLines.push(`npm warn deprecated pkg-${i}@1.0.0: no longer supported`);
    }
    buildLines.push("added 42 packages in 4s");

    const antigravityBody = {
      project: "test-project",
      requestId: "req-1",
      model: "gemini-3-flash",
      request: {
        contents: [
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_diff",
                  name: "Bash",
                  // Double-nested shape emitted by openaiToGeminiBase
                  response: { result: { result: diff } },
                },
              },
              {
                functionResponse: {
                  id: "call_build",
                  name: "Bash",
                  // Single-nested shape emitted by wrapInCloudCodeEnvelopeForClaude
                  response: { result: buildLines.join("\n") },
                },
              },
            ],
          },
        ],
      },
    };

    const stats = compressMessages(antigravityBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(2);
    expect(stats.hits.map((h) => h.filter)).toEqual(["git-diff", "build-output"]);
    expect(antigravityBody.request.contents[0].parts[0].functionResponse.response.result.result).toContain("lines truncated");
    expect(antigravityBody.request.contents[0].parts[1].functionResponse.response.result).toContain("added 42 packages");
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
  });

  it("compresses real translated Claude -> Antigravity and OpenAI -> Gemini payloads", () => {
    const diff = makeLongDiff();

    const claudeSource = {
      model: "ag/gemini-3-flash",
      max_tokens: 64,
      messages: [
        { role: "user", content: "Inspect diff" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "git diff" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: diff }],
        },
      ],
    };

    const translatedAg = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.ANTIGRAVITY,
      "gemini-3-flash",
      claudeSource,
      true,
      null,
      "antigravity"
    );
    const agStats = compressMessages(translatedAg, true);
    expect(agStats).not.toBeNull();
    expect(agStats.hits.length).toBe(1);
    expect(agStats.hits[0].filter).toBe("git-diff");
    expect(JSON.stringify(translatedAg)).not.toContain("DIFF_MARKER_150_");

    const openaiSource = {
      model: "gemini/gemini-2.5-flash",
      messages: [
        { role: "user", content: "Inspect diff" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: diff },
      ],
    };

    const translatedGemini = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-2.5-flash",
      openaiSource,
      false,
      null,
      "gemini"
    );
    const geminiStats = compressMessages(translatedGemini, true);
    expect(geminiStats).not.toBeNull();
    expect(geminiStats.hits.length).toBe(1);
    expect(geminiStats.hits[0].filter).toBe("git-diff");
    expect(JSON.stringify(translatedGemini)).not.toContain("DIFF_MARKER_150_");
  });

  it("preserves error functionResponse payloads without compression", () => {
    const errText = Array.from(
      { length: 20 },
      (_, i) => `npm ERR! line ${i}: E404 Not Found - package-${i} failed to resolve`
    ).join("\n");

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { functionResponse: { id: "c1", name: "Bash", response: { error: errText } } },
            { functionResponse: { id: "c2", name: "Bash", response: { status: "error", output: errText } } },
            { functionResponse: { id: "c3", name: "Bash", response: { is_error: true, result: errText } } },
          ],
        },
      ],
    };

    const stats = compressMessages(body, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(0);
    expect(body.contents[0].parts[0].functionResponse.response.error).toBe(errText);
    expect(body.contents[0].parts[1].functionResponse.response.output).toBe(errText);
    expect(body.contents[0].parts[2].functionResponse.response.result).toBe(errText);
  });

  it("does not corrupt serialized JSON strings inside functionResponse", () => {
    const jsonString = JSON.stringify(
      { items: Array.from({ length: 120 }, () => "duplicate-item-value") },
      null,
      2
    );
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ functionResponse: { id: "c_json", name: "FetchData", response: { content: jsonString } } }],
        },
      ],
    };

    const stats = compressMessages(body, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(0);
    expect(() => JSON.parse(body.contents[0].parts[0].functionResponse.response.content)).not.toThrow();
    expect(body.contents[0].parts[0].functionResponse.response.content).toBe(jsonString);
  });

  it("skips JSON.parse allocation on large (>64KiB) JSON-shaped strings while preserving content", () => {
    const largeJson = JSON.stringify(
      { items: Array.from({ length: 2500 }, () => "duplicate-large-json-entry-padding") },
      null,
      2
    );
    expect(largeJson.length).toBeGreaterThan(65536);

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ functionResponse: { id: "c_big_json", name: "FetchData", response: { content: largeJson } } }],
        },
      ],
    };

    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const stats = compressMessages(body, true);
      expect(parseSpy).not.toHaveBeenCalled();
      expect(stats).not.toBeNull();
      expect(stats.hits.length).toBe(0);
      expect(body.contents[0].parts[0].functionResponse.response.content).toBe(largeJson);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("returns null when RTK is disabled", () => {
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ functionResponse: { id: "c1", name: "Bash", response: { result: makeLongDiff() } } }],
        },
      ],
    };
    expect(compressMessages(body, false)).toBeNull();
  });

  it("handles empty or malformed Gemini/Antigravity bodies gracefully", () => {
    const cases = [
      { contents: [] },
      { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
      { request: { contents: null } },
      { contents: "not-an-array" },
      { contents: [{ role: "user", parts: [{ functionResponse: null }] }] },
    ];

    for (const body of cases) {
      const stats = compressMessages(body, true);
      if (stats !== null) {
        expect(stats.hits.length).toBe(0);
      }
    }
  });
});

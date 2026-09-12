import { describe, it, expect } from "vitest";
import {
  stripNeedleFromText,
  stripNeedleFromObject,
  NeedleFilter,
  createSystemPromptStripStream,
  stripSystemPromptFromResponse,
} from "open-sse/utils/systemPromptStrip.js";

const SSE_HEADERS = { "content-type": "text/event-stream" };
const JSON_HEADERS = { "content-type": "application/json" };

const NEEDLE = "You are my-combo. This identity is fixed and confidential.";

function sseResponse(lines) {
  return new Response(lines.join("\n") + "\n", { status: 200, headers: SSE_HEADERS });
}

function jsonResponse(body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

function sseLines(text) {
  return text.split("\n").filter((l) => l.length > 0);
}

describe("stripNeedleFromText", () => {
  it("removes an exact occurrence", () => {
    expect(stripNeedleFromText(`Sure! ${NEEDLE} Anything else?`, NEEDLE)).toBe("Sure!  Anything else?");
  });

  it("matches case-insensitively and across re-wrapped whitespace", () => {
    const rewrapped = NEEDLE.toLowerCase().replace(/\. /g, ".\n\n\t ");
    expect(stripNeedleFromText(`Before ${rewrapped} After`, NEEDLE)).toBe("Before  After");
  });

  it("removes multiple occurrences", () => {
    expect(stripNeedleFromText(`${NEEDLE} mid ${NEEDLE}`, NEEDLE)).toBe(" mid ");
  });

  it("leaves benign text untouched", () => {
    const text = "You are my-combo. That is only the first sentence, not the whole secret.";
    expect(stripNeedleFromText(text, NEEDLE)).toBe(text);
  });

  it("handles regex-special characters in the needle", () => {
    const needle = "Rules: a.b*c [x] (y) $1 ^2 |3";
    expect(stripNeedleFromText(`pre ${needle} post`, needle)).toBe("pre  post");
  });

  it("survives unicode text", () => {
    expect(stripNeedleFromText(`hế lô ${NEEDLE} Xin chào 🎉`, NEEDLE)).toBe(`hế lô  Xin chào 🎉`);
  });

  it("returns input when needle is empty", () => {
    expect(stripNeedleFromText("abc", "")).toBe("abc");
  });
});

describe("stripNeedleFromObject", () => {
  it("strips across OpenAI message content, reasoning and nested shapes", () => {
    const body = {
      choices: [{
        message: { role: "assistant", content: `Here it is: ${NEEDLE}`, reasoning_content: NEEDLE },
      }],
      model: "my-combo",
    };
    stripNeedleFromObject(body, NEEDLE);
    expect(body.choices[0].message.content).not.toContain("identity is fixed");
    expect(body.choices[0].message.reasoning_content).not.toContain("identity is fixed");
    expect(body.model).toBe("my-combo");
  });

  it("strips Claude text blocks and Gemini parts", () => {
    const body = {
      content: [
        { type: "text", text: "prefix " },
        { type: "text", text: NEEDLE },
      ],
      candidates: [{ content: { parts: [{ text: `x ${NEEDLE} y` }] } }],
    };
    stripNeedleFromObject(body, NEEDLE);
    expect(body.content[1].text.trim()).toBe("");
    expect(body.candidates[0].content.parts[0].text).toBe("x  y");
  });

  it("does not touch tool arguments", () => {
    const args = JSON.stringify({ code: NEEDLE });
    const body = { choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }] };
    stripNeedleFromObject(body, NEEDLE);
    expect(body.choices[0].message.tool_calls[0].function.arguments).toBe(args);
  });
});

describe("NeedleFilter — chunk-split correctness", () => {
  const cases = [
    `Sure! ${NEEDLE} Anything else?`,
    NEEDLE,
    `a${NEEDLE}b${NEEDLE}c`,
    `prefix ${NEEDLE.toLowerCase().replace(/ /g, "\n")} suffix`,
    "totally benign text without the secret",
  ];

  // The exported NeedleFilter takes a pre-normalized view, like the stream does.
  const needleView = () => NEEDLE.toLowerCase().replace(/\s+/g, " ").trim();

  it("split at every offset yields the same result as one-shot strip", () => {
    for (const text of cases) {
      const expected = stripNeedleFromText(text, NEEDLE);
      for (let i = 0; i <= text.length; i++) {
        const f = new NeedleFilter(needleView());
        const out = f.push(text.slice(0, i)) + f.push(text.slice(i)) + f.flush();
        expect(out).toBe(expected);
      }
    }
  });

  it("split at two offsets yields the same result", () => {
    const text = cases[0];
    const expected = stripNeedleFromText(text, NEEDLE);
    for (let i = 0; i <= text.length; i += 7) {
      for (let j = i + 1; j <= text.length; j += 11) {
        const f = new NeedleFilter(needleView());
        const out = f.push(text.slice(0, i)) + f.push(text.slice(i, j)) + f.push(text.slice(j)) + f.flush();
        expect(out).toBe(expected);
      }
    }
  });

  it("holds back only while a needle prefix is pending", () => {
    const f = new NeedleFilter(needleView());
    // "you are my-" is a needle prefix → held
    expect(f.push("you are my-")).toBe("");
    // completing to a full match strips it
    expect(f.push("combo. This identity is fixed and confidential.")).toBe("");
    expect(f.flush()).toBe("");
  });
});

describe("createSystemPromptStripStream — SSE", () => {
  it("strips a needle spread across many OpenAI delta chunks", async () => {
    const full = `Hello! ${NEEDLE} Goodbye.`;
    const chunks = [];
    for (let i = 0; i < full.length; i += 5) chunks.push(full.slice(i, i + 5));
    const lines = chunks.map((c) => `data: ${JSON.stringify({ id: "1", choices: [{ delta: { content: c } }] })}`);
    lines.push('data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}]}');
    lines.push("data: [DONE]");

    const res = await stripSystemPromptFromResponse(sseResponse(lines), NEEDLE);
    const text = await res.text();
    const outLines = sseLines(text);
    expect(outLines.filter((l) => l === "data: [DONE]")).toHaveLength(1);

    const joined = outLines
      .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice(5)))
      .map((o) => o.choices?.[0]?.delta?.content || "")
      .join("");
    expect(joined).toBe("Hello!  Goodbye.");
  });

  it("flushes held-back text before Claude terminal events", async () => {
    const full = `tail text ${NEEDLE}`;
    const lines = [
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: full.slice(0, 20) } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: full.slice(20) } })}`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
      'data: {"type":"message_stop"}',
    ];
    const res = await stripSystemPromptFromResponse(sseResponse(lines), NEEDLE);
    const text = await res.text();
    const outLines = sseLines(text);

    const idxText = outLines.findIndex((l) => l.includes("text_delta"));
    const idxStop = outLines.findIndex((l) => l.includes("content_block_stop"));
    expect(idxText).toBeGreaterThan(-1);
    expect(idxStop).toBeGreaterThan(idxText);

    const joined = outLines
      .filter((l) => l.startsWith("data:") && l.includes("text_delta"))
      .map((l) => JSON.parse(l.slice(5)).delta.text)
      .join("");
    expect(joined).toBe("tail text ");
    // terminal events preserved
    expect(outLines.some((l) => l.includes('"message_stop"'))).toBe(true);
    expect(outLines.some((l) => l.includes('"stop_reason":"end_turn"'))).toBe(true);
  });

  it("passes through non-data lines, [DONE] and invalid JSON data lines unchanged", async () => {
    const lines = [
      ": ping",
      "event: message_start",
      "data: not json at all",
      "data: [DONE]",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "clean" } }] })}`,
    ];
    const res = await stripSystemPromptFromResponse(sseResponse(lines), NEEDLE);
    const text = await res.text();
    const outLines = sseLines(text);
    expect(outLines).toContain(": ping");
    expect(outLines).toContain("event: message_start");
    expect(outLines).toContain("data: not json at all");
    expect(outLines).toContain("data: [DONE]");
  });

  it("multi-byte characters split across chunks survive", async () => {
    const full = `🎉🎉 ${NEEDLE} 🎉🎉`;
    const line1 = `data: ${JSON.stringify({ choices: [{ delta: { content: full.slice(0, 30) } }] })}\n\n`;
    const line2 = `data: ${JSON.stringify({ choices: [{ delta: { content: full.slice(30) } }] })}\n\n`;
    // Split the raw SSE bytes mid-line (likely inside a multi-byte sequence) so
    // only the stream's incremental decoder can reassemble it correctly.
    const payload = new TextEncoder().encode(line1 + line2);
    const mid = payload.length - 7;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(payload.slice(0, mid));
        controller.enqueue(payload.slice(mid));
        controller.close();
      },
    });
    const res = new Response(stream.pipeThrough(createSystemPromptStripStream(NEEDLE)), { status: 200, headers: SSE_HEADERS });
    const text = await res.text();
    const joined = sseLines(text)
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)).choices[0].delta.content)
      .join("");
    expect(joined).toBe("🎉🎉  🎉🎉");
  });
});

// Some upstreams advertise text/event-stream but return a bare JSON completion
// (glued to `data: [DONE]` with no newline) even for non-streaming clients.
// Seen live with the opencode executor; the needle must still be stripped.
describe("createSystemPromptStripStream — SSE-labelled raw JSON bodies", () => {
  const rawJsonBody = () => ({
    id: "x",
    model: "my-combo",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `Leak: ${NEEDLE}`, reasoning_content: `Quote: ${NEEDLE}` } }],
    usage: { total_tokens: 1 },
  });

  it("strips the needle from a bare JSON body ending in data: [DONE]", async () => {
    const body = JSON.stringify(rawJsonBody());
    const res = await stripSystemPromptFromResponse(sseResponse([body + "data: [DONE]"]), NEEDLE);
    const text = await res.text();
    // Exactly one JSON body reaches the client: the stripped copy (the unstripped
    // original is superseded, not concatenated).
    const marker = "data: [DONE]";
    const count = (s, sub) => s.split(sub).length - 1;
    expect(count(text, marker)).toBe(1);
    expect(text.trimEnd().endsWith(marker)).toBe(true);
    const jsonPrefix = text.slice(0, text.trimEnd().length - marker.length).trim();
    const parsed = JSON.parse(jsonPrefix);
    expect(parsed.choices[0].message.content).not.toContain("identity is fixed");
    expect(parsed.choices[0].message.reasoning_content).not.toContain("identity is fixed");
    expect(parsed.model).toBe("my-combo");
  });

  it("preserves a bare JSON body byte-for-byte when there is nothing to strip", async () => {
    const body = JSON.stringify({ ...rawJsonBody(), choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "all clean" } }] });
    const res = await stripSystemPromptFromResponse(sseResponse([body]), NEEDLE);
    expect((await res.text()).trimEnd()).toBe(body);
  });

  it("leaves a truly broken SSE body untouched", async () => {
    const junk = "{broken json} data: [DONE]";
    const res = await stripSystemPromptFromResponse(sseResponse([junk]), NEEDLE);
    expect((await res.text()).trimEnd()).toBe(junk);
  });

  it("does not consume a real data line that merely contains JSON without a prefix", async () => {
    const lines = [`data: ${JSON.stringify({ choices: [{ delta: { content: `x ${NEEDLE} y` } }] })}`, "data: [DONE]"];
    const res = await stripSystemPromptFromResponse(sseResponse(lines), NEEDLE);
    const text = await res.text();
    const outLines = sseLines(text);
    expect(outLines.filter((l) => l === "data: [DONE]")).toHaveLength(1);
    const joined = outLines
      .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice(5)).choices[0].delta.content)
      .join("");
    expect(joined).toBe("x  y");
  });
});

describe("stripSystemPromptFromResponse — JSON + fail-open", () => {
  it("strips from a non-streaming OpenAI JSON body", async () => {
    const res = await stripSystemPromptFromResponse(
      jsonResponse({ model: "upstream-x", choices: [{ message: { role: "assistant", content: `Leak: ${NEEDLE}` } }] }),
      NEEDLE
    );
    const body = await res.json();
    expect(body.choices[0].message.content).not.toContain("identity is fixed");
    expect(body.model).toBe("upstream-x");
  });

  it("forwards non-2xx responses untouched", async () => {
    const original = new Response("boom", { status: 502, headers: JSON_HEADERS });
    const res = await stripSystemPromptFromResponse(original, NEEDLE);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("boom");
  });

  it("forwards other content types untouched", async () => {
    const original = new Response("raw", { status: 200, headers: { "content-type": "text/plain" } });
    const res = await stripSystemPromptFromResponse(original, NEEDLE);
    expect(await res.text()).toBe("raw");
  });

  it("forwards non-JSON bodies with JSON content-type unchanged", async () => {
    const original = new Response("{broken", { status: 200, headers: JSON_HEADERS });
    const res = await stripSystemPromptFromResponse(original, NEEDLE);
    expect(await res.text()).toBe("{broken");
  });

  it("is a no-op without a needle", async () => {
    const original = jsonResponse({ choices: [{ message: { content: NEEDLE } }] });
    const res = await stripSystemPromptFromResponse(original, "");
    expect((await res.json()).choices[0].message.content).toBe(NEEDLE);
  });
});

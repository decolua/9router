// Gemini 4 long decode (CONTINUATION hops) for the Gemini API and Antigravity executors.
// Wire shapes probed live: the Gemini API takes a top-level continuationToken and Antigravity
// takes request.continuationToken (both TYPE_BYTES); Hydrogen on Antigravity accepts
// maxOutputTokens up to 1,000,000.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { getExecutor } = await import("../../open-sse/executors/index.js");
const { addGeminiUsage, wantsGeminiLongDecode, GEMINI_HOP_OUTPUT_TOKENS } = await import("../../open-sse/utils/geminiLongDecode.js");

const contents = [{ role: "user", parts: [{ text: "prove it" }] }];
const LONG = 262144;

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json" },
});

// Split the SSE text into small chunks so event lines straddle read boundaries.
const sseResponse = (events) => {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 7));
      offset += 7;
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
};

const readEvents = async (response) => (await response.text())
  .split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));

const sentBody = (call) => JSON.parse(fetchMock.mock.calls[call][1].body);

const cand = (parts, extra = {}) => ({ content: { role: "model", parts }, ...extra });

beforeEach(() => fetchMock.mockReset());

describe("long decode gating", () => {
  it("runs only for long-decode models asked for more than one hop", () => {
    expect(wantsGeminiLongDecode("gemini", "gemini-4-hydrogen", { maxOutputTokens: LONG })).toBe(true);
    expect(wantsGeminiLongDecode("antigravity", "gemini-4-hydrogen-xhigh", { maxOutputTokens: LONG })).toBe(true);
    expect(wantsGeminiLongDecode("gemini", "gemini-4-hydrogen", { maxOutputTokens: GEMINI_HOP_OUTPUT_TOKENS })).toBe(false);
    expect(wantsGeminiLongDecode("gemini", "gemini-4-argon", { maxOutputTokens: LONG })).toBe(false);
    expect(wantsGeminiLongDecode("gemini", "gemini-3.8-flash", { maxOutputTokens: LONG })).toBe(false);
  });

  it("sums numeric usage fields across hops", () => {
    expect(addGeminiUsage({ promptTokenCount: 10, totalTokenCount: 15 }, { promptTokenCount: 20, totalTokenCount: 30, thoughtsTokenCount: 4 }))
      .toEqual({ promptTokenCount: 30, totalTokenCount: 45, thoughtsTokenCount: 4 });
  });
});

describe("Gemini API (generateContent) long decode", () => {
  const gemini = getExecutor("gemini");
  const run = (stream, generationConfig = { maxOutputTokens: LONG }, model = "gemini-4-hydrogen") =>
    gemini.execute({ model, body: { contents, generationConfig }, stream, credentials: { apiKey: "k" } });

  it("re-sends the identical request with the token and joins the hops", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        candidates: [cand([{ text: "thinking", thought: true }, { text: "part1 " }], { finishReason: "CONTINUATION", continuationToken: "tok1" })],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        candidates: [cand([{ text: "part2" }], { finishReason: "STOP" })],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7, totalTokenCount: 27 },
        modelVersion: "gemini-4-hydrogen",
      }));

    const { response } = await run(false);
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = [sentBody(0), sentBody(1)];
    expect(first.continuationToken).toBeUndefined();
    expect(second).toEqual({ ...first, continuationToken: "tok1" });
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);

    expect(body.candidates[0].content.parts).toEqual([{ text: "thinking", thought: true }, { text: "part1 " }, { text: "part2" }]);
    expect(body.candidates[0].finishReason).toBe("STOP");
    expect(body.candidates[0].continuationToken).toBeUndefined();
    expect(body.usageMetadata).toEqual({ promptTokenCount: 30, candidatesTokenCount: 12, thoughtsTokenCount: 3, totalTokenCount: 45 });
  });

  it("ends as MAX_TOKENS with the hops so far when a continuation hop fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ candidates: [cand([{ text: "part1" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })] }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 400, message: "bad token" } }, 400));

    const body = await (await run(false)).response.json();
    expect(body.candidates[0].content.parts).toEqual([{ text: "part1" }]);
    expect(body.candidates[0].finishReason).toBe("MAX_TOKENS");
  });

  it("streams every hop as one turn, hiding the intermediate finish and offsetting usage", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse([
        { candidates: [cand([{ text: "Hel" }])], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 } },
        { candidates: [cand([{ text: "lo" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } },
      ]))
      .mockResolvedValueOnce(sseResponse([
        // Mid-hop checkpoint token: stripped, never triggers a hop.
        { candidates: [cand([{ text: " wor" }], { continuationToken: "checkpoint" })], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1, totalTokenCount: 13 } },
        { candidates: [cand([{ text: "ld" }], { finishReason: "STOP" })], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14 } },
      ]));

    const { response } = await run(true);
    const events = await readEvents(response);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain(":streamGenerateContent");
    expect(sentBody(1).continuationToken).toBe("tok1");
    expect(events.flatMap((e) => e.candidates[0].content?.parts || []).map((p) => p.text).join("")).toBe("Hello world");
    expect(events.map((e) => e.candidates[0].finishReason).filter(Boolean)).toEqual(["STOP"]);
    expect(JSON.stringify(events)).not.toContain("continuationToken");
    expect(events.at(-1).usageMetadata).toEqual({ promptTokenCount: 22, candidatesTokenCount: 4, totalTokenCount: 26 });
  });

  it("closes a stream with MAX_TOKENS when the next hop fails", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse([
        { candidates: [cand([{ text: "partial" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })], usageMetadata: { totalTokenCount: 5 } },
      ]))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 400 } }, 400));

    const events = await readEvents((await run(true)).response);
    expect(events.at(-1)).toEqual({ candidates: [{ finishReason: "MAX_TOKENS", index: 0 }], usageMetadata: { totalTokenCount: 5 } });
  });

  it("leaves single-hop requests untouched", async () => {
    const upstream = jsonResponse({ candidates: [cand([{ text: "hi" }], { finishReason: "STOP" })] });
    fetchMock.mockResolvedValueOnce(upstream);
    const { response } = await run(false, { maxOutputTokens: 8192 });
    expect(response).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not loop for models without long decode", async () => {
    const upstream = jsonResponse({ candidates: [cand([{ text: "x" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })] });
    fetchMock.mockResolvedValueOnce(upstream);
    const { response } = await run(false, { maxOutputTokens: LONG }, "gemini-4-argon");
    expect(response).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Antigravity (Cloud Code envelope) long decode", () => {
  const ag = getExecutor("antigravity");
  const credentials = { accessToken: "t", projectId: "project", connectionId: "connection" };
  const run = (model, maxOutputTokens, stream = false) => ag.execute({
    model,
    body: { model, request: { contents, generationConfig: { maxOutputTokens } } },
    stream,
    credentials,
  });

  it("keeps Hydrogen's budget above 64K and puts the token inside the envelope", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ response: {
        candidates: [cand([{ text: "a" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })],
        usageMetadata: { totalTokenCount: 100 },
      } }))
      .mockResolvedValueOnce(jsonResponse({ response: {
        candidates: [cand([{ text: "b" }], { finishReason: "STOP" })],
        usageMetadata: { totalTokenCount: 50 },
      } }));

    const body = await (await run("gemini-4-hydrogen-high", 300000)).response.json();

    expect(sentBody(0).request.generationConfig.maxOutputTokens).toBe(300000);
    expect(sentBody(0).request.continuationToken).toBeUndefined();
    expect(sentBody(1).request.continuationToken).toBe("tok1");
    expect(sentBody(1).continuationToken).toBeUndefined();
    expect(sentBody(1).model).toBe("gemini-4-hydrogen-high");
    expect(body.response.candidates[0].content.parts).toEqual([{ text: "a" }, { text: "b" }]);
    expect(body.response.candidates[0].finishReason).toBe("STOP");
    expect(body.response.usageMetadata).toEqual({ totalTokenCount: 150 });
  });

  it("streams wrapped hops as one turn", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse([{ response: { candidates: [cand([{ text: "a" }], { finishReason: "CONTINUATION", continuationToken: "tok1" })] } }]))
      .mockResolvedValueOnce(sseResponse([{ response: { candidates: [cand([{ text: "b" }], { finishReason: "STOP" })] } }]));

    const events = await readEvents((await run("gemini-4-hydrogen-xhigh", LONG, true)).response);
    expect(sentBody(1).request.continuationToken).toBe("tok1");
    expect(events.map((e) => e.response.candidates[0].content.parts[0].text).join("")).toBe("ab");
    expect(events.map((e) => e.response.candidates[0].finishReason).filter(Boolean)).toEqual(["STOP"]);
  });

  it("still caps models without long decode at 64000", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: { candidates: [cand([{ text: "x" }], { finishReason: "STOP" })] } }));
    await run("gemini-4-argon-high", 300000);
    expect(sentBody(0).request.generationConfig.maxOutputTokens).toBe(64000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

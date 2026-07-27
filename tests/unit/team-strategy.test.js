import { describe, it, expect, vi } from "vitest";

import { handleTeamChat } from "../../open-sse/services/team.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Minimal OpenAI-chat Response stub with the .ok + .clone().json() surface the engine uses.
function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  return make();
}

function errResponse(status = 500) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message: "boom" } }) });
  return make();
}

// A judge/synthesise response is JSON prose the pipeline parses for {score, feedback}.
function judgeResponse(score, feedback = "") {
  return okResponse(JSON.stringify({ score, feedback }));
}

// A streaming (SSE) Response stub: real Response whose body streams OpenAI-style chunks.
function sseResponse(content) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drain(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
}

const base = { messages: [{ role: "user", content: "Q" }], stream: false, tools: [{ name: "x" }] };
const baseStream = { ...base, stream: true };

describe("team combo strategy", () => {
  it("answers directly with a single-model combo (nothing to orchestrate)", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("solo"));
    await handleTeamChat({
      body: base,
      models: ["p/only"],
      handleSingleModel,
      log,
      team: { worker: "p/only" },
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel.mock.calls[0][1]).toBe("p/only");
  });

  it("runs planner -> worker -> reviewers -> judge -> compressor in order", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      seen.push(model);
      if (model === "p/judge") return judgeResponse(9, "great");
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse(`ans-${model}`);
    });

    const res = await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: {
        planner: "p/plan",
        worker: "p/w",
        reviewers: ["p/r1", "p/r2"],
        judge: "p/judge",
        compressor: "p/comp",
        planReview: false,
      },
    });

    // planner, worker, r1, r2, judge, compressor
    expect(seen[0]).toBe("p/plan");
    expect(seen[1]).toBe("p/w");
    expect(seen.slice(2, 4).sort()).toEqual(["p/r1", "p/r2"]);
    expect(seen[4]).toBe("p/judge");
    expect(seen[5]).toBe("p/comp");
    expect(res.ok).toBe(true);
  });

  it("forces internal stages non-streaming with tools stripped; the compressor keeps the client's flags", async () => {
    const handleSingleModel = vi.fn(async (body, model, isInternal) => {
      if (model === "p/judge") return judgeResponse(10);
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse("x");
    });

    await handleTeamChat({
      body: base, // non-streaming client request
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });

    for (const [body, model, isInternal] of handleSingleModel.mock.calls) {
      if (model === "p/comp") {
        expect(body.stream).toBe(false); // client didn't ask to stream
        expect(body.tools).toEqual([{ name: "x" }]); // compressor keeps the client's tools
        expect(isInternal).toBeFalsy();
      } else {
        expect(body.stream).toBe(false);
        expect(body.tools).toBeUndefined();
        expect(isInternal).toBe(true);
      }
    }
  });

  it("streaming: emits an immediate heartbeat, then streams the compressed answer", async () => {
    const handleSingleModel = vi.fn(async (body, model, isInternal) => {
      if (model === "p/comp") { expect(body.stream).toBe(true); return sseResponse("FINAL"); }
      if (model === "p/judge") return judgeResponse(9);
      return okResponse("draft");
    });

    const res = await handleTeamChat({
      body: baseStream,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });

    // First chunk is an SSE comment (heartbeat) delivered before the pipeline finishes.
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first.startsWith(":")).toBe(true);

    let rest = "";
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += dec.decode(value); }
    expect(rest).toContain("FINAL");
  });

  it("streaming: falls back to the approved answer when the compressor is exhausted", async () => {
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/comp") return errResponse(500);
      if (model === "p/judge") return judgeResponse(9);
      return okResponse("APPROVED");
    });
    const res = await handleTeamChat({
      body: baseStream,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    const text = await drain(res);
    expect(text).toContain("APPROVED");
  });

  it("vets the plan with a plan-reviewer when planReview is on", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      seen.push(model);
      if (model === "p/judge") return judgeResponse(9);
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse("x");
    });
    await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: true },
    });
    // planner runs twice conceptually: draft + review both use the planner chain.
    expect(seen.filter((m) => m === "p/plan").length).toBe(2);
  });

  it("falls back to the next model in a role chain when the first fails", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      seen.push(model);
      if (model === "p/w1") return errResponse(500);
      if (model === "p/judge") return judgeResponse(9);
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse("x");
    });
    await handleTeamChat({
      body: base,
      models: ["p/w1"],
      handleSingleModel,
      log,
      team: { worker: ["p/w1", "p/w2"], reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    expect(seen).toContain("p/w1");
    expect(seen).toContain("p/w2"); // fell through to the backup worker
  });

  it("loops until the judge score meets the pass threshold", async () => {
    let judgeCalls = 0;
    const workers = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/w") { workers.push(model); return okResponse("draft"); }
      if (model === "p/judge") { judgeCalls++; return judgeResponse(judgeCalls === 1 ? 4 : 9); }
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse("x");
    });
    await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", maxIters: 3, passThreshold: 8, planReview: false },
    });
    expect(workers.length).toBe(2); // failed once, passed on 2nd
    expect(judgeCalls).toBe(2);
  });

  it("caps the loop at maxIters and still returns a compressed answer", async () => {
    let workerCalls = 0;
    let compCalled = false;
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/w") { workerCalls++; return okResponse("draft"); }
      if (model === "p/judge") return judgeResponse(2); // never passes
      if (model === "p/comp") { compCalled = true; return okResponse("FINAL"); }
      return okResponse("x");
    });
    const res = await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", maxIters: 2, passThreshold: 8, planReview: false },
    });
    expect(workerCalls).toBe(2);
    expect(compCalled).toBe(true);
    expect(res.ok).toBe(true);
  });

  it("skips review and compresses the worker answer when all reviewers fail", async () => {
    let judgeCalls = 0;
    let compCalled = false;
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/r1" || model === "p/r2") return errResponse(500);
      if (model === "p/judge") { judgeCalls++; return judgeResponse(9); }
      if (model === "p/comp") { compCalled = true; return okResponse("FINAL"); }
      return okResponse("draft");
    });
    await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { worker: "p/w", reviewers: ["p/r1", "p/r2"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    expect(judgeCalls).toBe(0); // no critiques -> nothing to judge
    expect(compCalled).toBe(true);
  });

  it("answers raw when the planner chain is exhausted", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model) => {
      seen.push(model);
      if (model === "p/plan") return errResponse(500);
      if (model === "p/judge") return judgeResponse(9);
      if (model === "p/comp") return okResponse("FINAL");
      return okResponse("draft");
    });
    const res = await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { planner: "p/plan", worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    expect(seen).toContain("p/w"); // worker still runs
    expect(res.ok).toBe(true);
  });

  it("streams the approved answer directly when the compressor is exhausted", async () => {
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/comp") return errResponse(500);
      if (model === "p/judge") return judgeResponse(9);
      return okResponse("APPROVED");
    });
    const res = await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    expect(res.ok).toBe(true);
    const json = await res.clone().json();
    expect(json.choices[0].message.content).toBe("APPROVED");
  });

  it("returns 503 when the worker cannot produce anything on the first iteration", async () => {
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/w") return errResponse(500);
      return okResponse("x");
    });
    const res = await handleTeamChat({
      body: base,
      models: ["p/w"],
      handleSingleModel,
      log,
      team: { worker: "p/w", reviewers: ["p/r1"], judge: "p/judge", compressor: "p/comp", planReview: false },
    });
    expect(res.status).toBe(503);
  });
});

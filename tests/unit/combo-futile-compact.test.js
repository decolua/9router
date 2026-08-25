import { describe, expect, it } from "vitest";

// 2026-08-25. A session was refused at 189,547 tokens against a 160,000 ceiling,
// compacted 116,399 tokens of history down to 39,532 — and was refused again at
// 167,293. The number barely moved because the bulk was never history: the
// system prompt and eight MCP servers' tool schemas are ~224k characters before
// a single message is counted. The client had no third move.
const { measureFloor, measureBody, IMAGE_TOKEN_ESTIMATE } = await import(
  "../../open-sse/utils/usageTracking.js"
);

const body = () => ({
  system: "S".repeat(1000),
  tools: [{ name: "t", description: "D".repeat(4000) }],
  messages: [
    { role: "user", content: "H".repeat(50000) },       // history
    { role: "assistant", content: "H".repeat(50000) },  // history
    { role: "user", content: "the turn in flight" },    // floor
  ],
});

describe("measureFloor measures what compaction cannot remove", () => {
  it("counts the system prompt, the tools and the current turn", () => {
    const floor = measureFloor(body());
    expect(floor.chars).toBeGreaterThan(5000);
    // ...and none of the 100k characters of history.
    expect(floor.chars).toBeLessThan(20000);
    expect(floor.chars).toBeLessThan(measureBody(body()).chars);
  });

  it("counts a whole trailing run, because text and image arrive separately", () => {
    const b = body();
    b.messages.push({ role: "user", content: "X".repeat(3000) });
    expect(measureFloor(b).chars).toBeGreaterThan(measureFloor(body()).chars + 2900);
  });

  it("treats an OpenAI-shaped system message as floor too", () => {
    const b = { messages: [{ role: "system", content: "S".repeat(9000) }, { role: "user", content: "hi" }] };
    expect(measureFloor(b).chars).toBeGreaterThan(9000);
  });

  it("strips inlined base64 exactly like measureBody, and counts the image", () => {
    const b = body();
    b.messages.push({
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "i".repeat(90000) } }],
    });
    const floor = measureFloor(b);
    expect(floor.images).toBe(1);
    expect(floor.chars).toBeLessThan(20000); // the 90k of base64 is not text
    expect(IMAGE_TOKEN_ESTIMATE).toBe(1600);
  });

  it("returns zero for a body it cannot read, so sizing never throws", () => {
    expect(measureFloor(null)).toEqual({ chars: 0, images: 0 });
    expect(measureFloor("nope")).toEqual({ chars: 0, images: 0 });
  });

});

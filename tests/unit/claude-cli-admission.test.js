import { describe, it, expect } from "vitest";
import { pinMessageBreakpoint } from "open-sse/executors/claudeCliAdmission.js";

/**
 * Moving the prompt-cache breakpoint off the CLI's per-request context.
 *
 * Measured against claude 2.1.281 on 2026-09-24, which is what this encodes:
 *
 *   straight to the API   cache_write 40514 / 40515 / 40514, cache_read 0 / 0 / 0
 *   through the relay     cache_write 20135 /     0 /     0, cache_read 0 / 20135 / 20135
 *
 * — same 30-turn history, a different final question each time, which is what
 * an agent loop always does. Without the relay every request rewrites the whole
 * history; with it the history is read back.
 *
 * The marker positions, captured from a real request:
 *   before  messages=31  marker at 30/35 (the newest user turn, block 35)
 *   after   messages=31  marker at 29/0  (the last assistant message)
 *
 * 9Router sent that final turn as ONE block. The other thirty-five are the
 * CLI's own per-request context, and the next request replays the turn without
 * them — so a marker on or after them can never match again.
 */

const marker = () => ({ type: "ephemeral" });
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });

/** Where the single message-level marker ended up, as "message/block". */
function markerAt(payload) {
  const body = JSON.parse(payload.toString("utf8"));
  const found = [];
  body.messages.forEach((m, i) => {
    (Array.isArray(m.content) ? m.content : []).forEach((b, j) => {
      if (b && typeof b === "object" && b.cache_control) found.push(`${i}/${j}`);
    });
  });
  return found.join(",");
}

const encode = (body) => Buffer.from(JSON.stringify(body), "utf8");

describe("pinMessageBreakpoint", () => {
  // The shape the CLI actually sends: our one block, then its own additions,
  // with the marker on the last of them.
  const realistic = () => ({
    messages: [
      { role: "user", content: [text("q1")] },
      { role: "assistant", content: [text("a1")] },
      {
        role: "user",
        content: [
          text("the question 9Router asked"),
          text("<system-reminder>today's date is ...</system-reminder>"),
          text("<system-reminder>signed in as ...</system-reminder>", { cache_control: marker() }),
        ],
      },
    ],
  });

  it("moves the marker back off the context the CLI appended", () => {
    const queried = [text("the question 9Router asked")];
    const out = pinMessageBreakpoint(encode(realistic()), queried);
    // Onto our own block of the newest turn, which the next request replays
    // byte for byte — not onto the reminders, which it will not.
    expect(markerAt(out)).toBe("2/0");
  });

  it("stops at the first block the CLI changed, not merely added", () => {
    const body = realistic();
    // The CLI reworded our block. Everything from there on is unstable.
    body.messages[2].content[0] = text("the question, reworded by the CLI");
    const out = pinMessageBreakpoint(encode(body), [text("the question 9Router asked")]);
    expect(markerAt(out)).toBe("1/0");
  });

  it("falls back to the last assistant turn when the newest turn is all theirs", () => {
    const body = {
      messages: [
        { role: "user", content: [text("q1")] },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("entirely the CLI's", { cache_control: marker() })] },
      ],
    };
    expect(markerAt(pinMessageBreakpoint(encode(body), [text("ours")]))).toBe("1/0");
  });

  it("never moves the marker later than the CLI put it", () => {
    // Already as early as it can be: leave it exactly there.
    const body = {
      messages: [
        { role: "user", content: [text("q1", { cache_control: marker() })] },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("ours")] },
      ],
    };
    expect(markerAt(pinMessageBreakpoint(encode(body), [text("ours")]))).toBe("0/0");
  });

  it("will not park the marker on a block the server cannot cache", () => {
    const body = {
      messages: [
        { role: "user", content: [text("q1")] },
        { role: "assistant", content: [text("a1"), { type: "thinking", thinking: "hmm" }] },
        { role: "user", content: [text("ours"), text("theirs", { cache_control: marker() })] },
      ],
    };
    // 2/0 is ours and cacheable, so it wins over the thinking block at 1/1.
    expect(markerAt(pinMessageBreakpoint(encode(body), [text("ours")]))).toBe("2/0");
  });

  it("leaves a payload alone when there is not exactly one message marker", () => {
    const two = {
      messages: [
        { role: "user", content: [text("q1", { cache_control: marker() })] },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("ours", { cache_control: marker() })] },
      ],
    };
    const payload = encode(two);
    expect(pinMessageBreakpoint(payload, [text("ours")])).toBe(payload);

    const none = { messages: [{ role: "user", content: [text("q1")] }] };
    const bare = encode(none);
    expect(pinMessageBreakpoint(bare, [text("q1")])).toBe(bare);
  });

  it("forwards anything it cannot read, rather than dropping the request", () => {
    for (const payload of [Buffer.from("not json"), Buffer.from("{}"), Buffer.from('{"messages":"?"}')]) {
      expect(pinMessageBreakpoint(payload, [text("ours")])).toBe(payload);
    }
  });

  it("does nothing without the turn to compare against", () => {
    const payload = encode(realistic());
    expect(pinMessageBreakpoint(payload, null)).toBe(payload);
    expect(pinMessageBreakpoint(payload, [])).toBe(payload);
  });

  it("never changes the content itself, only where the marker sits", () => {
    const before = realistic();
    const out = JSON.parse(pinMessageBreakpoint(encode(before), [text("the question 9Router asked")]).toString("utf8"));
    const strip = (body) => JSON.stringify(body.messages.map((m) => ({
      role: m.role,
      content: m.content.map(({ cache_control, ...rest }) => rest),
    })));
    expect(strip(out)).toBe(strip(before));
  });
});

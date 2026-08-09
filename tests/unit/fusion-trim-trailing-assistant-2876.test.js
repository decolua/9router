// Issue #2876 — Fusion panel requests fail on Claude with
// "conversation must end with a user message" because the inbound turn can end on an
// assistant message (client echoed a partial assistant reply). trimTrailingAssistant
// removes trailing assistant roles so the panel request terminates on a user turn.

import { describe, expect, it } from "vitest";
import { trimTrailingAssistant } from "../../open-sse/services/combo.js";

describe("trimTrailingAssistant (#2876)", () => {
  it("leaves a user-ending conversation untouched", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ];
    expect(trimTrailingAssistant(msgs)).toEqual(msgs);
  });

  it("trims a single trailing assistant message", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "assistant", content: "continued" },
    ];
    const out = trimTrailingAssistant(msgs);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("trims multiple trailing assistant messages", () => {
    const msgs = [
      { role: "user", content: "q" },
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
      { role: "assistant", content: "a3" },
    ];
    const out = trimTrailingAssistant(msgs);
    expect(out).toEqual([{ role: "user", content: "q" }]);
  });

  it("returns original when all messages are assistant (never empty)", () => {
    const msgs = [{ role: "assistant", content: "only" }];
    expect(trimTrailingAssistant(msgs)).toEqual(msgs);
  });

  it("handles empty / non-array input", () => {
    expect(trimTrailingAssistant([])).toEqual([]);
    expect(trimTrailingAssistant(null)).toBeNull();
  });
});

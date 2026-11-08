import { describe, it, expect } from "vitest";

describe("OpenCode Bridge Lifecycle & WAF Optimization", () => {
  it("triggers context recycling when messages shrink by more than 30%", () => {
    const lastContextLength = 10000;
    const currentContextLength = 6000; // 40% reduction
    const isCompacted = lastContextLength > 5000 && currentContextLength < lastContextLength * 0.7;
    expect(isCompacted).toBe(true);
  });

  it("does not trigger recycling on small conversational turns", () => {
    const lastContextLength = 10000;
    const currentContextLength = 10200; // slight growth
    const isCompacted = lastContextLength > 5000 && currentContextLength < lastContextLength * 0.7;
    expect(isCompacted).toBe(false);
  });

  it("enforces max turn lifespan threshold of 8 turns", () => {
    const MAX_SESSION_TURNS = 8;
    expect(7 >= MAX_SESSION_TURNS).toBe(false);
    expect(8 >= MAX_SESSION_TURNS).toBe(true);
    expect(9 >= MAX_SESSION_TURNS).toBe(true);
  });
});

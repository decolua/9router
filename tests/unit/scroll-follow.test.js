import { describe, it, expect } from "vitest";
import { isPinnedToBottom, SCROLL_FOLLOW_SLACK_PX } from "../../src/shared/utils/scrollFollow.js";

// A scroll box, measured the way the DOM measures one.
const box = ({ scrollTop, scrollHeight = 1000, clientHeight = 400 }) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("isPinnedToBottom", () => {
  it("is true at the exact bottom", () => {
    expect(isPinnedToBottom(box({ scrollTop: 600 }))).toBe(true);
  });

  it("is false while the reader is looking at older lines", () => {
    // This is the case #3838 is about: the log kept yanking them back here.
    expect(isPinnedToBottom(box({ scrollTop: 0 }))).toBe(false);
    expect(isPinnedToBottom(box({ scrollTop: 300 }))).toBe(false);
  });

  it("tolerates the sub-pixel residue a pinned element reports", () => {
    // scrollHeight/clientHeight are integers while scrollTop is fractional, so
    // an element that is at the bottom can be a pixel or two short of it.
    expect(isPinnedToBottom(box({ scrollTop: 600 - 1.5 }))).toBe(true);
    expect(isPinnedToBottom(box({ scrollTop: 600 - SCROLL_FOLLOW_SLACK_PX }))).toBe(true);
  });

  it("stops following once past the slack", () => {
    expect(isPinnedToBottom(box({ scrollTop: 600 - SCROLL_FOLLOW_SLACK_PX - 1 }))).toBe(false);
  });

  it("follows a log short enough not to scroll at all", () => {
    // scrollHeight === clientHeight: there is no 'older' to read.
    expect(isPinnedToBottom(box({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }))).toBe(true);
  });

  it("follows when there is no element or no measurement yet", () => {
    // First paint, or a detached node: the previous behaviour was to scroll, and
    // freezing the log would be worse than scrolling it.
    expect(isPinnedToBottom(null)).toBe(true);
    expect(isPinnedToBottom(undefined)).toBe(true);
    expect(isPinnedToBottom({})).toBe(true);
    expect(isPinnedToBottom(box({ scrollTop: NaN }))).toBe(true);
  });

  it("honours an explicit slack", () => {
    expect(isPinnedToBottom(box({ scrollTop: 590 }), 0)).toBe(false);
    expect(isPinnedToBottom(box({ scrollTop: 590 }), 20)).toBe(true);
  });
});

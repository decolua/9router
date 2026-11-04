import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The update banner must never sit frozen while the page changes under it:
 * every navigation replays its entrance, and dismissal plays an exit before the
 * element leaves. These are structural checks on the component that owns both
 * motions.
 */
const src = fs.readFileSync(
  path.resolve(__dirname, "../..", "src/shared/components/UpdateBanner.js"),
  "utf8"
);

describe("update banner animation", () => {
  it("tracks the route so the banner can re-enter per navigation", () => {
    expect(src).toContain('usePathname');
    expect(src).toContain("const pathname = usePathname()");
  });

  it("re-keys the banner on route change, replaying the entrance animation", () => {
    expect(src).toMatch(/key=\{pathname\}/);
    expect(src).toContain("slide-in-top");
  });

  it("swaps to a real transition while closing (the keyframe fills forwards)", () => {
    expect(src).toMatch(/closing \? [^\n]*opacity-0[^\n]*duration-200/);
    // the enter class must not stay applied while exiting
    expect(src).toMatch(/closing \? [^:]*: "slide-in-top"/);
  });

  it("dismiss animates out first, then commits", () => {
    const at = src.indexOf("setClosing(true)");
    const commit = src.indexOf("setDismissed(identity)", at);
    const timer = src.indexOf("}, 200)", at);
    expect(at).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(at);
    expect(timer).toBeGreaterThan(at);
    // localStorage write happens inside the deferred branch, after the exit
    expect(src.lastIndexOf("localStorage.setItem(DISMISSED_KEY", commit)).toBeGreaterThan(at);
  });

  it("cleans the closing flag so a future dismiss still animates", () => {
    expect(src).toMatch(/setClosing\(false\)/);
  });
});
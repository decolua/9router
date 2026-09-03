import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [],
  params: new Map(),
  stateIndex: 0,
  stateSetters: [],
  stateValues: [],
}));

vi.mock("react", () => ({
  Suspense: function Suspense() {},
  useEffect: (effect) => { harness.effects.push(effect); },
  useState: (initialValue) => {
    const index = harness.stateIndex++;
    const value = index < harness.stateValues.length ? harness.stateValues[index] : initialValue;
    const setter = vi.fn();
    harness.stateSetters[index] = setter;
    return [value, setter];
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key) => harness.params.get(key) || null }),
}));

import CallbackPage from "../../src/app/callback/page.js";

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return textContent(node.props?.children);
}

function renderContent(stateValues) {
  harness.effects = [];
  harness.stateIndex = 0;
  harness.stateSetters = [];
  harness.stateValues = stateValues;
  const page = CallbackPage();
  return page.props.children.type();
}

describe("OAuth callback page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.params = new Map([
      ["error", "access_denied"],
      ["error_description", "The user denied authorization"],
      ["state", "callback-state"],
    ]);
    globalThis.window = {
      close: vi.fn(),
      location: {
        href: "http://localhost:20127/callback?error=access_denied",
        origin: "http://localhost:20127",
      },
      opener: { postMessage: vi.fn() },
    };
  });

  it("renders provider denial as a sanitized error state", () => {
    const message = "Authorization was denied. Restart sign-in and try again.";
    const errorTree = renderContent([]);
    const output = textContent(errorTree);
    expect(output).toContain("Authorization Failed");
    expect(output).toContain(message);
    expect(output).not.toContain("Authorization Successful");

    harness.effects[0]();
    expect(window.opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ error: message }),
    }), "http://localhost:20127");
    vi.advanceTimersByTime(2_000);
    expect(harness.stateSetters[0]).not.toHaveBeenCalledWith("done");
  });
});

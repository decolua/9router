import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useId: vi.fn(),
}));

vi.mock("react", () => ({
  useId: mocks.useId,
}));

import OAuthProxyPoolSelector from "../../src/shared/components/OAuthProxyPoolSelector.js";

function findElement(node, type) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, type);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  return findElement(node.props?.children, type);
}

function renderSelector() {
  return OAuthProxyPoolSelector({
    value: "",
    onChange: vi.fn(),
    proxyPools: [{ id: "pool-1", name: "Pool 1" }],
    proxyPoolsReady: true,
    visible: true,
  });
}

describe("OAuth proxy selector IDs", () => {
  beforeEach(() => {
    mocks.useId
      .mockReset()
      .mockReturnValueOnce("selector-1")
      .mockReturnValueOnce("selector-2");
  });

  it("associates each label with a stable unique select ID", () => {
    const first = renderSelector();
    const second = renderSelector();
    const firstLabel = findElement(first, "label");
    const firstSelect = findElement(first, "select");
    const secondLabel = findElement(second, "label");
    const secondSelect = findElement(second, "select");

    expect(firstLabel.props.htmlFor).toBe(firstSelect.props.id);
    expect(secondLabel.props.htmlFor).toBe(secondSelect.props.id);
    expect(firstSelect.props.id).not.toBe(secondSelect.props.id);
  });
});

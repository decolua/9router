import { describe, expect, it } from "vitest";
import {
  FALLBACK_COLOR_PALETTE,
  TOPOLOGY_GEOMETRY,
  estimateProviderNodeWidth,
  getCompatibleBadge,
  getFallbackProviderColor,
  getTopologyPosition,
} from "@/shared/providerTopology";
import { getProviderDisplayIconSrc } from "@/shared/utils/providerIcon";

describe("provider topology helpers", () => {
  it("gives custom providers a stable palette color", () => {
    const color = getFallbackProviderColor("openai-compatible-chat-acme");
    expect(getFallbackProviderColor("openai-compatible-chat-acme")).toBe(color);
    expect(FALLBACK_COLOR_PALETTE).toContain(color);
    expect(FALLBACK_COLOR_PALETTE).toContain(getFallbackProviderColor(undefined));
  });

  it("labels compatible nodes by API kind", () => {
    expect(getCompatibleBadge("anthropic-compatible-acme")).toBe("AC");
    expect(getCompatibleBadge("openai-compatible-chat-acme", "chat")).toBe("OC");
    expect(getCompatibleBadge("openai-compatible-responses-acme", "responses")).toBe("OR");
    expect(getCompatibleBadge("openai", "chat")).toBe("");
  });

  it("sizes nodes to their label within min/max bounds", () => {
    const { providerMinWidth, providerMaxWidth } = TOPOLOGY_GEOMETRY;
    expect(estimateProviderNodeWidth("Groq")).toBe(providerMinWidth);
    expect(estimateProviderNodeWidth("")).toBe(providerMinWidth);
    const relay = estimateProviderNodeWidth("Claude Relay (EU)");
    expect(relay).toBeGreaterThan(providerMinWidth);
    expect(relay).toBeLessThan(providerMaxWidth);
    expect(estimateProviderNodeWidth("Responses Gateway")).toBe(relay);
    expect(estimateProviderNodeWidth("x".repeat(200))).toBe(providerMaxWidth);
  });

  it("places node centers on an ellipse starting at the top, spaced for the widest node", () => {
    const top = getTopologyPosition(0, 4);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(-TOPOLOGY_GEOMETRY.minRadiusY);
    expect(getTopologyPosition(1, 4).x).toBeCloseTo(TOPOLOGY_GEOMETRY.minRadiusX);

    // Many nodes: arc spacing must fit the widest node plus the gap.
    const count = 40;
    for (const width of [TOPOLOGY_GEOMETRY.providerMinWidth, TOPOLOGY_GEOMETRY.providerMaxWidth]) {
      const right = getTopologyPosition(count / 4, count, width);
      const arc = (2 * Math.PI * right.x) / count;
      expect(arc).toBeGreaterThanOrEqual(width + TOPOLOGY_GEOMETRY.providerGap - 1e-9);
    }
    expect(getTopologyPosition(0, 0)).toEqual(getTopologyPosition(0, 1));
  });
});

describe("getProviderDisplayIconSrc", () => {
  it("uses the shared compatible-provider icons", () => {
    expect(getProviderDisplayIconSrc("openai-compatible-responses-acme", "responses")).toBe("/providers/oai-r.png");
    expect(getProviderDisplayIconSrc("openai-compatible-chat-acme", "chat")).toBe("/providers/oai-cc.png");
    expect(getProviderDisplayIconSrc("anthropic-compatible-acme")).toBe("/providers/anthropic-m.png");
  });

  it("falls back to the provider's own icon", () => {
    expect(getProviderDisplayIconSrc("openai")).toBe("/providers/openai.png");
    expect(getProviderDisplayIconSrc("gitlab-duo")).toBe("/providers/gitlab.png");
  });
});

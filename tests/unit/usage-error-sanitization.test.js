import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getClaudeUsage } from "../../open-sse/services/usage/claude.js";
import { getGrokCliUsage } from "../../open-sse/services/usage/grok-cli.js";
import { getVercelAiGatewayUsage } from "../../open-sse/services/usage/misc.js";

const secret = "https://user:password@provider.test/usage?access_token=SECRET-TOKEN";

function expectSanitized(message) {
  expect(message.length).toBeLessThanOrEqual(240);
  for (const value of ["user", "password", "SECRET-TOKEN"]) expect(message).not.toContain(value);
}

describe("usage provider error sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes Claude proxy failures", async () => {
    proxyAwareFetch.mockRejectedValue(new Error(secret));

    expectSanitized((await getClaudeUsage("token", { disableEnvProxy: true })).message);
  });

  it("does not return Grok provider error bodies", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(new Response(secret, { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    expectSanitized((await getGrokCliUsage("token", null, { disableEnvProxy: true })).message);
  });

  it("does not return Vercel provider error bodies", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(secret, { status: 502 }));

    expectSanitized((await getVercelAiGatewayUsage("api-key", { disableEnvProxy: true })).message);
  });
});

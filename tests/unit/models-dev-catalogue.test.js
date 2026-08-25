import { beforeEach, describe, expect, it, vi } from "vitest";

// The provider registry is a 122-file static import; the join only needs the
// four fields prefixesOf() reads, so stand in for it.
vi.mock("../../open-sse/providers/registry/index.js", () => ({
  default: [
    { id: "opencode", alias: "oc", uiAlias: "oc" },
    { id: "opencode-go", alias: "opencode-go", aliases: ["ocg"], uiAlias: "ocg" },
    { id: "openrouter", alias: "openrouter" },
    { id: "not-in-models-dev", alias: "nimd" },
  ],
}));

vi.mock("../../open-sse/services/contextWindowRegistry.js", () => ({
  observeContextWindow: vi.fn(async () => true),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { observeContextWindow } from "../../open-sse/services/contextWindowRegistry.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { refreshModelsDevCatalogue } from "../../open-sse/services/modelsDevCatalogue.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CATALOGUE = {
  opencode: {
    models: {
      "x-preview-f-free": { limit: { context: 1000000, output: 131072 } },
      "no-limit-published": {},
    },
  },
  "opencode-go": {
    models: { "glm-5.2": { limit: { context: 1000000 } } },
  },
  // Has a catalogue service of its own; models.dev must not touch it.
  openrouter: {
    models: { "stealth/ox-alpha": { limit: { context: 200000 } } },
  },
};

function recorded() {
  return Object.fromEntries(observeContextWindow.mock.calls.map(([id, win]) => [id, win]));
}

describe("models.dev catalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyAwareFetch.mockResolvedValue(jsonResponse(CATALOGUE));
  });

  it("gives opencode's ox-alpha its real 1M window instead of the 200K default", async () => {
    await refreshModelsDevCatalogue({ force: true });
    expect(recorded()["oc/x-preview-f-free"]).toBe(1000000);
  });

  it("records under every alias a routed id can use", async () => {
    await refreshModelsDevCatalogue({ force: true });
    const got = recorded();
    // The combo stores one spelling and the executor logs another; a window
    // filed under only one of them leaves the other on the 200K default.
    expect(got["ocg/glm-5.2"]).toBe(1000000);
    expect(got["opencode-go/glm-5.2"]).toBe(1000000);
  });

  it("leaves providers that publish their own catalogue alone", async () => {
    await refreshModelsDevCatalogue({ force: true });
    expect(recorded()).not.toHaveProperty("openrouter/stealth/ox-alpha");
  });

  it("ignores models that publish no window", async () => {
    await refreshModelsDevCatalogue({ force: true });
    expect(recorded()).not.toHaveProperty("oc/no-limit-published");
  });

  it("returns 0 and does not throw when models.dev is unreachable", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(refreshModelsDevCatalogue({ force: true })).resolves.toBe(0);
    expect(observeContextWindow).not.toHaveBeenCalled();
  });

  it("returns 0 and does not throw on a non-200", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({}, 503));
    await expect(refreshModelsDevCatalogue({ force: true })).resolves.toBe(0);
    expect(observeContextWindow).not.toHaveBeenCalled();
  });
});

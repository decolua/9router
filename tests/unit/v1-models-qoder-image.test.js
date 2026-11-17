// /v1/models: the Qoder live catalog only lists chat models, so the static
// Cloud Agents image model (qd/imagegen) is appended for PAT connections only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(async () => ({})),
  routableQoderModels: vi.fn(() => [
    { id: "auto", name: "Auto" },
    { id: "qmodel_latest", name: "Qwen" },
  ]),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

function qoderConnection(fields) {
  db.getProviderConnections.mockResolvedValue([{ id: 1, provider: "qoder", isActive: true, providerSpecificData: {}, ...fields }]);
}

describe("/v1/models Qoder image model", () => {
  beforeEach(() => db.getProviderConnections.mockReset());

  it("lists qd/imagegen as an image model for PAT connections", async () => {
    qoderConnection({ apiKey: "pt-test" });
    const images = (await buildModelsList(["image"])).map((m) => m.id);
    expect(images).toContain("qd/imagegen");
    const chat = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(chat).toContain("qd/qmodel_latest");
    expect(chat).not.toContain("qd/imagegen");
  });

  it("does not list it for OAuth connections, which cannot use Cloud Agents", async () => {
    qoderConnection({ accessToken: "dt-device-token" });
    const images = (await buildModelsList(["image"])).map((m) => m.id);
    expect(images).not.toContain("qd/imagegen");
  });
});

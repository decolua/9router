import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

/**
 * OpenAI-compatible aggregator providers. Each was verified by probing the
 * live /v1/models endpoint: a 401 with a structured error body confirms a
 * real API behind the host, and Dahl/Kira answer 200 with no credentials.
 */
const BATCH = [
  {
    id: "dahl",
    category: "apikey",
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
    modelsUrl: "https://inference.dahl.global/v1/models",
    aliases: ["dahl-inference"],
  },
  {
    id: "atria",
    category: "apikey",
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    modelsUrl: "https://api.atria-asi.ai/v1/models",
    aliases: ["atria-asi"],
  },
  {
    id: "agnes",
    category: "freeTier",
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    modelsUrl: "https://apihub.agnes-ai.com/v1/models",
    aliases: ["agnes-ai"],
  },
  {
    id: "bai",
    category: "apikey",
    baseUrl: "https://api.b.ai/v1/chat/completions",
    modelsUrl: "https://api.b.ai/v1/models",
    aliases: ["b-ai"],
  },
];

describe.each(BATCH)("$id provider", (p) => {
  const entry = REGISTRY.find((e) => e.id === p.id);

  it("is registered with the expected category and base URL", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe(p.category);
    expect(PROVIDERS[p.id].baseUrl).toBe(p.baseUrl);
    expect(PROVIDERS[p.id].format).toBe("openai");
  });

  it("exposes its aliases and a UI display name", () => {
    for (const a of p.aliases) expect(entry.aliases).toContain(a);
    expect(entry.display?.name).toBeTruthy();
    expect(entry.display?.textIcon).toBeTruthy();
  });

  it("routes through the shared DefaultExecutor", () => {
    expect(getExecutor(p.id)).toBeInstanceOf(DefaultExecutor);
  });

  it("accepts arbitrary model ids via passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
  });
});

describe("Atria Dawn specifics", () => {
  const entry = REGISTRY.find((e) => e.id === "atria");

  it("is named after the service, not just the host", () => {
    expect(entry.display.name).toBe("Atria Dawn");
  });

  it("pins the single documented preview model", () => {
    expect(entry.models.map((m) => m.id)).toEqual(["Atria-Dawn-Preview"]);
  });
});

describe("provider icons", () => {
  // This file lives in tests/unit/, so resolve icons against the repo root.
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("ships a /public/providers/{id}.png for every provider in the batch", () => {
    // getProviderIconSrc() resolves /providers/{id}.png and falls back to the
    // textIcon tile when the file 404s, so a missing icon is silent in the UI.
    for (const p of BATCH.map((x) => x.id)) {
      expect(existsSync(join(REPO_ROOT, "public", "providers", `${p}.png`))).toBe(true);
    }
  });
});

describe("authenticated model discovery", () => {
  const ROUTE = join(
    dirname(fileURLToPath(import.meta.url)), "..", "..",
    "src", "app", "api", "providers", "[id]", "models", "route.js"
  );
  const source = readFileSync(ROUTE, "utf8");

  it("registers every batch provider in the /models resolver", () => {
    // Without an entry here the route answers
    // 400 "Provider X does not support models listing" and live discovery
    // silently fails once a key is saved.
    for (const p of BATCH.map((x) => x.id)) {
      expect(source).toContain(`${p}: createOpenAIModelsConfig(`);
    }
  });

  it("points each entry at that provider's own /models URL", () => {
    for (const p of BATCH) {
      const line = source.split("\n").find((l) => l.trim().startsWith(`${p.id}: createOpenAIModelsConfig(`));
      expect(line, `no models entry for ${p.id}`).toBeTruthy();
      expect(line).toContain(p.modelsUrl);
    }
  });
});

describe("batch invariants", () => {
  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not claim vision for any provider in the batch", () => {
    // These aggregators relay third-party models; none of them has documented
    // image input, so no registry entry may assert it.
    for (const p of BATCH) {
      const entry = REGISTRY.find((e) => e.id === p.id);
      expect(entry.serviceKinds ?? ["llm"]).toContain("llm");
      expect(entry.imageToTextConfig).toBeUndefined();
    }
  });
});

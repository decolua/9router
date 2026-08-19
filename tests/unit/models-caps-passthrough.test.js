/**
 * Regression test for the /api/models capability surface.
 *
 * The route hand-picks fields off getCapabilitiesForModel(). It previously
 * dropped `thinkingFormat`, which silently degraded every adaptive/budget
 * thinking model to a generic `effort` ladder once the CLI-tools writers
 * turned those caps into models.yml.
 *
 * This invokes the real GET() export rather than re-implementing its
 * projection, so a future narrowing of the route is actually caught.
 * `next/server` and the two DB-backed helpers are stubbed so the module
 * loads under Vitest in Node.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "path";
import { fileURLToPath } from "url";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { buildOmpModelEntry, OMP_THINKING_MODES } from "@/shared/constants/ompModelSchema.js";

const projectRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const routePath = join(projectRoot, "src/app/api/models/route.js").replace(/\\/g, "/");

let route;

beforeAll(async () => {
  // Same NextResponse.json(payload, init) shape used by omp-cli-settings.test.js.
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(payload, init) {
        const status = init?.status ?? 200;
        return { status, async json() { return payload; } };
      },
    },
  }));

  // Both helpers hit SQLite; neither affects the capability projection.
  vi.doMock("@/models", () => ({
    getModelAliases: async () => ({}),
    setModelAlias: async () => {},
  }));
  vi.doMock("@/lib/disabledModelsDb", () => ({
    getDisabledModels: async () => ({}),
  }));

  route = await import(routePath);
});

async function getModels() {
  const res = await route.GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.models || [];
}

const find = (models, fullModel) => models.find((m) => m.fullModel === fullModel);

describe("/api/models capability projection", () => {
  it("returns caps for a known adaptive model", async () => {
    const m = find(await getModels(), "cc/claude-opus-5");
    expect(m).toBeTruthy();
    expect(m.caps.thinkingFormat).toBe("claude-adaptive");
    expect(m.caps.contextWindow).toBe(1000000);
    expect(m.caps.maxOutput).toBe(128000);
    expect(m.caps.reasoning).toBe(true);
    expect(m.caps.vision).toBe(true);
  });

  it("never drops thinkingFormat for any reasoning model it exposes", async () => {
    const models = await getModels();
    const reasoning = models.filter((m) => m.caps?.reasoning);
    expect(reasoning.length).toBeGreaterThan(0);

    const dropped = [];
    for (const m of reasoning) {
      const source = getCapabilitiesForModel(m.provider, m.model);
      if (source.thinkingFormat && m.caps.thinkingFormat !== source.thinkingFormat) {
        dropped.push({ model: m.fullModel, expected: source.thinkingFormat, got: m.caps.thinkingFormat });
      }
    }
    expect(dropped).toEqual([]);
  });

  it("feeds the omp writer well enough to produce anthropic-adaptive", async () => {
    const m = find(await getModels(), "cc/claude-opus-5");
    const entry = buildOmpModelEntry(m.fullModel, m.caps);
    expect(entry.thinking.mode).toBe(OMP_THINKING_MODES.ANTHROPIC_ADAPTIVE);
    expect(entry.thinking.efforts).toEqual(["low", "medium", "high", "max"]);
    expect(entry.contextWindow).toBe(1000000);
    expect(entry.maxTokens).toBe(128000);
  });

  it("would regress to `effort` if the route dropped thinkingFormat again", async () => {
    const m = find(await getModels(), "cc/claude-opus-5");
    const { thinkingFormat, ...narrowed } = m.caps;
    expect(thinkingFormat).toBeTruthy();
    const entry = buildOmpModelEntry(m.fullModel, narrowed);
    expect(entry.thinking.mode).toBe(OMP_THINKING_MODES.EFFORT);
  });
});

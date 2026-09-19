import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveModelAliasFromMap } from "open-sse/services/model.js";

// Canonical convention (src/lib/db/repos/aliasRepo.js:9-16, open-sse/services/model.js):
// the modelAliases map is keyed by ALIAS, with value "provider/model".
// setModelAlias(alias, model). These tests lock every /api/models* admin route
// to that convention (findings T1.5 M1 + B7).

const mocks = vi.hoisted(() => {
  const store = { aliases: {}, custom: [] };
  return {
    store,
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
    // In-memory stand-in implementing the REAL aliasRepo signature:
    // key = alias, value = "provider/model".
    getModelAliases: vi.fn(async () => ({ ...store.aliases })),
    setModelAlias: vi.fn(async (alias, model) => {
      store.aliases[alias] = model;
    }),
    deleteModelAlias: vi.fn(async (alias) => {
      delete store.aliases[alias];
    }),
    getCustomModels: vi.fn(async () => store.custom),
    addCustomModel: vi.fn(async (m) => {
      store.custom.push(m);
      return true;
    }),
    deleteCustomModel: vi.fn(async () => {}),
    getDisabledModels: vi.fn(async () => ({})),
  };
});

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));

vi.mock("@/models", () => ({
  getModelAliases: mocks.getModelAliases,
  setModelAlias: mocks.setModelAlias,
  deleteModelAlias: mocks.deleteModelAlias,
  getCustomModels: mocks.getCustomModels,
  addCustomModel: mocks.addCustomModel,
  deleteCustomModel: mocks.deleteCustomModel,
}));

vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

const { PUT: putModels, GET: getModels } = await import("../../src/app/api/models/route.js");
const { PUT: putAlias } = await import("../../src/app/api/models/alias/route.js");

const putJson = (url, body) =>
  new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/models alias convention (M1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.aliases = {};
    mocks.store.custom = [];
  });

  it("PUT /api/models stores {alias: 'provider/model'} so the router resolves it", async () => {
    const res = await putModels(
      putJson("http://localhost/api/models", { model: "claude/sonnet-4", alias: "chat-fast" })
    );

    expect(res.status).toBe(200);
    expect(mocks.store.aliases).toEqual({ "chat-fast": "claude/sonnet-4" });
    // Round-trip through the real routing consumer:
    const resolved = resolveModelAliasFromMap("chat-fast", mocks.store.aliases);
    expect(resolved).not.toBe(null);
    expect(resolved.model).toBe("sonnet-4");
  });

  it("PUT /api/models rejects an alias already pointing at a different model and keeps the old binding", async () => {
    await putModels(
      putJson("http://localhost/api/models", { model: "claude/sonnet-4", alias: "chat-fast" })
    );

    const res = await putModels(
      putJson("http://localhost/api/models", { model: "grok/grok-3", alias: "chat-fast" })
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Alias already in use" });
    // The real alias must survive — this was M1's silent-overwrite effect.
    expect(mocks.store.aliases).toEqual({ "chat-fast": "claude/sonnet-4" });
  });

  it("PUT /api/models is idempotent for the same alias→model pair", async () => {
    await putModels(
      putJson("http://localhost/api/models", { model: "claude/sonnet-4", alias: "chat-fast" })
    );
    const res = await putModels(
      putJson("http://localhost/api/models", { model: "claude/sonnet-4", alias: "chat-fast" })
    );
    expect(res.status).toBe(200);
    expect(mocks.store.aliases).toEqual({ "chat-fast": "claude/sonnet-4" });
  });
});

describe("/api/models GET alias display (M1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.aliases = {};
    mocks.store.custom = [];
  });

  it("GET /api/models shows the canonical alias stored by PUT /api/models", async () => {
    await putModels(
      putJson("http://localhost/api/models", { model: "testprov/mymodel", alias: "my-alias" })
    );
    mocks.store.custom = [
      { providerAlias: "testprov", id: "mymodel", type: "llm", name: "MyModel" },
    ];

    const res = await getModels();

    expect(res.status).toBe(200);
    const entry = res.body.models.find((m) => m.fullModel === "testprov/mymodel");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("my-alias");
  });

  it("GET /api/models shows an alias created via PUT /api/models/alias (same key/value)", async () => {
    await putAlias(
      putJson("http://localhost/api/models/alias", { model: "testprov/mymodel", alias: "alias-a" })
    );
    mocks.store.custom = [
      { providerAlias: "testprov", id: "mymodel", type: "llm", name: "MyModel" },
    ];

    const res = await getModels();

    const entry = res.body.models.find((m) => m.fullModel === "testprov/mymodel");
    expect(entry.alias).toBe("alias-a");
  });

  it("GET /api/models matches aliases keyed by the routed provider/model form", async () => {
    const listRes = await getModels();
    const target = listRes.body.models[0];
    expect(target).toBeDefined();
    // Dashboard writes values as "providerAlias/model" (ModelsCard routedModel form).
    await putAlias(
      putJson("http://localhost/api/models/alias", { model: target.routedModel, alias: "routed-alias" })
    );

    const res = await getModels();
    const entry = res.body.models.find((m) => m.fullModel === target.fullModel);
    expect(entry.alias).toBe("routed-alias");
  });

  it("GET /api/models falls back to the model name when no alias exists", async () => {
    const res = await getModels();
    const entry = res.body.models[0];
    expect(entry.alias).toBe(entry.model);
  });
});

const { POST: postCustom } = await import("../../src/app/api/models/custom/route.js");

describe("/api/models/alias conflict check (B7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.aliases = {};
    mocks.store.custom = [];
  });

  it("PUT /api/models/alias rejects an alias already pointing at a different model", async () => {
    await putAlias(
      putJson("http://localhost/api/models/alias", { model: "claude/sonnet-4", alias: "chat-fast" })
    );

    const res = await putAlias(
      putJson("http://localhost/api/models/alias", { model: "grok/grok-3", alias: "chat-fast" })
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Alias already in use" });
    expect(mocks.store.aliases).toEqual({ "chat-fast": "claude/sonnet-4" });
  });

  it("PUT /api/models/alias allows re-setting the same alias→model pair", async () => {
    await putAlias(
      putJson("http://localhost/api/models/alias", { model: "claude/sonnet-4", alias: "chat-fast" })
    );
    const res = await putAlias(
      putJson("http://localhost/api/models/alias", { model: "claude/sonnet-4", alias: "chat-fast" })
    );
    expect(res.status).toBe(200);
    expect(mocks.store.aliases).toEqual({ "chat-fast": "claude/sonnet-4" });
  });

  it("PUT /api/models/alias and PUT /api/models write the same key/value (mirror routes agree)", async () => {
    await putAlias(
      putJson("http://localhost/api/models/alias", { model: "grok/grok-3", alias: "shared" })
    );
    const viaModels = await putModels(
      putJson("http://localhost/api/models", { model: "grok/grok-3", alias: "shared" })
    );
    expect(viaModels.status).toBe(200);
    expect(mocks.store.aliases).toEqual({ shared: "grok/grok-3" });
  });
});

describe("/api/models/custom input validation (B7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.aliases = {};
    mocks.store.custom = [];
  });

  const postJson = (body) =>
    new Request("http://localhost/api/models/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a non-string id with 400 instead of polluting KV with [object Object]", async () => {
    const res = await postCustom(postJson({ providerAlias: "testprov", id: { nested: 1 } }));
    expect(res.status).toBe(400);
    expect(mocks.addCustomModel).not.toHaveBeenCalled();
  });

  it("rejects a non-string providerAlias with 400", async () => {
    const res = await postCustom(postJson({ providerAlias: 42, id: "m1" }));
    expect(res.status).toBe(400);
    expect(mocks.addCustomModel).not.toHaveBeenCalled();
  });

  it("accepts string providerAlias/id", async () => {
    const res = await postCustom(postJson({ providerAlias: "testprov", id: "m1", name: "M1" }));
    expect(res.status).toBe(200);
    expect(mocks.addCustomModel).toHaveBeenCalledWith(
      expect.objectContaining({ providerAlias: "testprov", id: "m1" })
    );
  });
});

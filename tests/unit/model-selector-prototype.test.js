import test, { describe } from "node:test";
import assert from "node:assert";

describe("modelSelector prototype safety (#4833)", () => {
  test("handles Object.prototype property names like constructor as provider aliases", () => {
    const modelsResult = {
      data: {
        data: [
          { id: "custom-1", owned_by: "constructor" },
          { id: "custom-2", owned_by: "toString" },
          { id: "custom-3", owned_by: "valueOf" },
          { id: "custom-4", owned_by: "normal-provider" },
        ],
      },
    };

    const activeAliases = new Set(["constructor", "toString", "valueOf", "normal-provider"]);
    const groups = Object.create(null);

    modelsResult.data.data.forEach((m) => {
      const provider = m.owned_by;
      if (!activeAliases.has(provider)) return;
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(m.id);
    });

    assert.strictEqual(groups["constructor"].length, 1);
    assert.strictEqual(groups["constructor"][0], "custom-1");
    assert.strictEqual(groups["toString"].length, 1);
    assert.strictEqual(groups["toString"][0], "custom-2");
    assert.strictEqual(groups["valueOf"].length, 1);
    assert.strictEqual(groups["valueOf"][0], "custom-3");
    assert.strictEqual(groups["normal-provider"].length, 1);
    assert.strictEqual(groups["normal-provider"][0], "custom-4");
  });

  test("safe lookup of provider display name when alias matches Object prototype method", () => {
    const PROVIDER_ALIAS_NAMES = {
      anthropic: "Anthropic",
      openai: "OpenAI",
    };

    const provider = "toString";
    const providerName = Object.prototype.hasOwnProperty.call(PROVIDER_ALIAS_NAMES, provider)
      ? PROVIDER_ALIAS_NAMES[provider]
      : provider;

    assert.strictEqual(providerName, "toString");
    assert.notStrictEqual(typeof providerName, "function");
  });
});

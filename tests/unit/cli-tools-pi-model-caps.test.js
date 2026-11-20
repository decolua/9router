import { describe, it, expect } from "vitest";
import {
  PI_THINKING_LEVELS,
  PI_DEFAULT_THINKING_LEVELS,
  PI_DEFAULT_CAPS,
  levelsFromServer,
  thinkingLevelMapFromLevels,
  capsFromModelInfo,
  buildPiModelEntry,
  buildPiModelEntry as buildEntry,
  readPiModels,
  readThinkingLevels,
  sanitizePiInput,
  sanitizePiThinkingLevelMap,
  sanitizePiModelCaps,
} from "@/shared/utils/piModels.js";

// Regression: the Pi card on /dashboard/cli-tools/pi only configured contextWindow
// and maxTokens per model, so every model reached Pi as text-only with no thinking
// support even when 9Router's catalog already knows it takes images or reasons. The
// card now seeds each added model from /api/models caps and writes Pi's `input`,
// `reasoning` and `thinkingLevelMap` fields.
describe("capsFromModelInfo seeds a model from catalog capabilities", () => {
  it("enables image input and thinking for a vision reasoning model", () => {
    const caps = capsFromModelInfo({ vision: true, reasoning: true, contextWindow: 400000, maxOutput: 32000 });

    expect(caps.input).toEqual(["text", "image"]);
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(400000);
    expect(caps.maxTokens).toBe(32000);
    // Levels are unknown until /api/models reports them, so the card keeps Pi's
    // own default set rather than asserting levels the model may not have.
    expect(caps.thinkingLevels).toBeNull();
  });

  it("falls back to text-only defaults when the catalog knows nothing", () => {
    const caps = capsFromModelInfo(undefined);

    expect(caps.input).toEqual(["text"]);
    expect(caps.reasoning).toBe(false);
    expect(caps.contextWindow).toBe(PI_DEFAULT_CAPS.contextWindow);
    expect(caps.maxTokens).toBe(PI_DEFAULT_CAPS.maxTokens);
  });

  it("ignores out-of-range context and output values", () => {
    const caps = capsFromModelInfo({ contextWindow: -1, maxOutput: 9000000 });

    expect(caps.contextWindow).toBe(PI_DEFAULT_CAPS.contextWindow);
    expect(caps.maxTokens).toBe(PI_DEFAULT_CAPS.maxTokens);
  });
});

describe("buildPiModelEntry writes Pi's model fields", () => {
  it("states text-only and no thinking explicitly", () => {
    const entry = buildEntry("oc/muse-spark-1.2", {});

    expect(entry.input).toEqual(["text"]);
    expect(entry.reasoning).toBe(false);
  });

  it("writes image input and reasoning when enabled", () => {
    const entry = buildEntry("oc/union-alpha", { input: ["text", "image"], reasoning: true });

    expect(entry.input).toEqual(["text", "image"]);
    expect(entry.reasoning).toBe(true);
  });

  it("marks a disabled thinking level unsupported with null", () => {
    const entry = buildEntry("oc/union-alpha", {
      reasoning: true,
      thinkingLevels: ["off", "low", "medium", "high"],
    });

    expect(entry.thinkingLevelMap).toEqual({
      off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null,
    });
  });

  it("clears a stored map with an empty object, never null", () => {
    // Pi's ThinkingLevelMapSchema is an object, so a null map invalidates the whole
    // models.json and Pi then reports every provider in it as unknown.
    const entry = buildEntry("oc/union-alpha", { reasoning: true, thinkingLevels: ["high"] });

    expect(entry.thinkingLevelMap).toEqual({
      off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null,
    });

    const idle = buildEntry("oc/union-alpha", { reasoning: false });
    expect(idle.thinkingLevelMap).toEqual({});
  });

  it("omits the map when the levels are unknown, so a hand-written one survives", () => {
    const entry = buildEntry("oc/union-alpha", { reasoning: true, thinkingLevels: null });

    expect(entry).not.toHaveProperty("thinkingLevelMap");
  });

  it("keeps a display name from a hand-written models.json", () => {
    // The card always sends name === id, so the route restores a custom name. The
    // entry itself is the card's view and stays id-based.
    expect(buildPiModelEntry("a/b", {}).name).toBe("a/b");
  });
});

describe("readPiModels reads the card state back out", () => {
  it("returns null when the provider is absent", () => {
    expect(readPiModels({ providers: {} })).toBeNull();
    expect(readPiModels({})).toBeNull();
  });

  it("reads capabilities, tolerating plain string entries", () => {
    const parsed = readPiModels({
      providers: {
        "9router": {
          models: [
            "plain/string-entry",
            {
              id: "oc/vision-thinker",
              contextWindow: 600000,
              maxTokens: 128000,
              input: ["text", "image"],
              reasoning: true,
              thinkingLevelMap: { minimal: null },
            },
          ],
        },
      },
    });

    expect(parsed.ids).toEqual(["plain/string-entry", "oc/vision-thinker"]);
    expect(parsed.caps["oc/vision-thinker"]).toEqual({
      contextWindow: 600000,
      maxTokens: 128000,
      input: ["text", "image"],
      reasoning: true,
      thinkingLevels: ["off", "low", "medium", "high"],
    });
  });
});

describe("readThinkingLevels treats an omitted level as supported", () => {
  it("falls back to Pi's default set when no map is stored", () => {
    // xhigh and max are only supported when mapped, so Pi's no-map default stops at high.
    expect(readThinkingLevels(undefined)).toEqual(PI_DEFAULT_THINKING_LEVELS);
  });

  it("drops only the levels mapped to null", () => {
    expect(readThinkingLevels({ off: null, xhigh: "xhigh" })).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });
});

describe("route sanitizers drop values Pi would reject", () => {
  it("keeps only known input values and removes duplicates", () => {
    expect(sanitizePiInput(["text", "image", "video", "text"])).toEqual(["text", "image"]);
  });

  it("drops an input list with no usable value", () => {
    expect(sanitizePiInput(["video"])).toBeUndefined();
    expect(sanitizePiInput("text")).toBeUndefined();
  });

  it("keeps known thinking levels with string or null values only", () => {
    const clean = sanitizePiThinkingLevelMap({
      off: null,
      minimal: "minimal",
      low: 3,
      xhigh: "xhigh",
      unknownLevel: "nope",
      high: { nested: true },
    });

    expect(clean).toEqual({ off: null, minimal: "minimal", xhigh: "xhigh" });
  });

  it("drops a map with nothing usable", () => {
    expect(sanitizePiThinkingLevelMap({ bogus: 1 })).toBeUndefined();
    expect(sanitizePiThinkingLevelMap([])).toBeUndefined();
  });
});

describe("sanitizePiModelCaps keeps an entry schema-clean", () => {
  it("drops values Pi would reject instead of writing them back", () => {
    // Regression: next = { ...prev, ...m } kept a hand-edited bogus value because the
    // sanitizer only skipped fields it could not read, never removed them.
    const clean = sanitizePiModelCaps({
      contextWindow: 400000,
      input: ["video", "audio"],
      reasoning: "yes",
      thinkingLevelMap: { bogus: 1, high: {} },
    });

    expect(clean).toEqual({});
  });

  it("keeps only the valid capability fields", () => {
    const clean = sanitizePiModelCaps({
      input: ["text", "image", "text"],
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: "minimal", nope: 1 },
    });

    expect(clean).toEqual({
      input: ["text", "image"],
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: "minimal" },
    });
  });

  it("clears a stored map when the field is null", () => {
    expect(sanitizePiModelCaps({ input: ["text"], reasoning: false, thinkingLevelMap: null })).toEqual({
      input: ["text"],
      reasoning: false,
    });
  });
});

describe("no generated entry can be null where Pi requires an object", () => {
  const cases = [
    { reasoning: false },
    { reasoning: true },
    { reasoning: true, thinkingLevels: ["high"] },
    { reasoning: true, thinkingLevels: [] },
  ];

  it("keeps thinkingLevelMap an object or absent in every shape", () => {
    for (const caps of [...cases, { reasoning: true, thinkingLevels: null }, { reasoning: true, thinkingLevels: PI_THINKING_LEVELS }]) {
      const entry = buildPiModelEntry("oc/x", caps);
      if ("thinkingLevelMap" in entry) {
        expect(typeof entry.thinkingLevelMap).toBe("object");
        expect(entry.thinkingLevelMap).not.toBeNull();
        expect(Array.isArray(entry.thinkingLevelMap)).toBe(false);
      }
    }
  });
});

// 9Router resolves the levels a model really serves (thinkingLevels.js) and
// /api/models now publishes them, so the card can map a Pi level to the value
// 9Router expects instead of leaving xhigh/max unreachable.
describe("levelsFromServer speaks Pi's level vocabulary", () => {
  it("maps 9Router's none to off and keeps the rest", () => {
    expect(levelsFromServer(["none", "low", "medium", "high"])).toEqual(["off", "low", "medium", "high"]);
  });

  it("keeps xhigh and max, which Pi only supports through an explicit mapping", () => {
    expect(levelsFromServer(["low", "high", "max"])).toEqual(["low", "high", "max"]);
    expect(levelsFromServer(["none", "minimal", "low", "medium", "high", "xhigh"])).toEqual([
      "off", "minimal", "low", "medium", "high", "xhigh",
    ]);
  });

  it("returns null when the model has no levels or a level Pi cannot express", () => {
    expect(levelsFromServer(undefined)).toBeNull();
    expect(levelsFromServer([])).toBeNull();
    expect(levelsFromServer(["none", "thinking"])).toBeNull();   // zai binary
    expect(levelsFromServer(["low", "ultra"])).toBeNull();       // codex
  });

  it("orders levels the way Pi does", () => {
    expect(levelsFromServer(["max", "none", "high", "low"])).toEqual(["off", "low", "high", "max"]);
  });
});

describe("thinkingLevelMapFromLevels writes the provider value for each level", () => {
  it("matches the mapping Pi's docs use for DeepSeek", () => {
    // getThinkingLevels("oc", "deepseek-v4.1-flash-free") -> low, high, max
    expect(thinkingLevelMapFromLevels(["low", "high", "max"])).toEqual({
      off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max",
    });
  });

  it("sends none for off", () => {
    expect(thinkingLevelMapFromLevels(["off", "minimal", "low", "medium", "high", "xhigh", "max"])).toEqual({
      off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
    });
  });

  it("round-trips through readThinkingLevels", () => {
    for (const levels of [["low", "high", "max"], ["off", "high"], PI_THINKING_LEVELS]) {
      expect(readThinkingLevels(thinkingLevelMapFromLevels(levels))).toEqual(levels);
    }
  });
});

describe("a model added from the catalog arrives with its resolved levels", () => {
  it("seeds the levels and writes them into the entry", () => {
    const caps = capsFromModelInfo({ reasoning: true, thinking_levels: ["none", "low", "high", "max"] });
    expect(caps.thinkingLevels).toEqual(["off", "low", "high", "max"]);

    const entry = buildPiModelEntry("cmc/deepseek/deepseek-v4.1-flash", caps);
    expect(entry.reasoning).toBe(true);
    expect(entry.thinkingLevelMap).toEqual({
      off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max",
    });
  });

  it("drops the map when thinking is turned off", () => {
    const caps = capsFromModelInfo({ reasoning: true, thinking_levels: ["low", "high", "max"] });
    const entry = buildPiModelEntry("m", { ...caps, reasoning: false });
    expect(entry.reasoning).toBe(false);
    expect(entry.thinkingLevelMap).toEqual({});
  });
});

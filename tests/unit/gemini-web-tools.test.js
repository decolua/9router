import { describe, expect, it } from "vitest";
import {
  buildInnerPayload,
  buildModelHeader,
  buildPromptWithTools,
  cleanGeminiText,
  makeSapisidHash,
  parseStreamReasoning,
  resolveGeminiWebModel,
  HEX,
  LEGACY_HEX,
  HEX_TO_MODEL,
  GEMINI_WEB_MODELS,
  GeminiWebExecutor,
} from "../../open-sse/executors/gemini-web.js";
import geminiWebRegistry from "../../open-sse/providers/registry/gemini-web.js";
import {
  buildToolInstructions,
  buildToolReminder,
  hasTools,
  parseToolCallReply,
} from "../../open-sse/executors/webCookieToolBridge.js";

describe("gemini-web registry and models", () => {
  it("lists all 8 supported models in registry", () => {
    const expectedModelIds = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-4-argon",
      "gemini-3.8-flash-thinking",
      "gemini-3.5-flash-lite-thinking",
      "gemini-3.1-pro-thinking",
      "gemini-4-argon-thinking",
    ];
    const registeredIds = geminiWebRegistry.models.map((m) => m.id);
    expect(registeredIds).toEqual(expectedModelIds);
    expect(geminiWebRegistry.passthroughModels).toBe(true);
  });

  it("resolves all registry models to active hexes and correct thinking mode", () => {
    for (const model of geminiWebRegistry.models) {
      const cfg = resolveGeminiWebModel(model.id);
      expect(cfg.hexID).toBeTruthy();
      expect(typeof cfg.hexID).toBe("string");
      expect(cfg.hexID.length).toBe(16);
      expect(cfg.mode).toBeGreaterThan(0);
      if (model.id.endsWith("-thinking")) {
        expect(cfg.thinking).toBe(true);
      } else {
        expect(cfg.thinking).toBe(false);
      }
    }
  });
});

describe("gemini-web model table", () => {
  it("defaults to 3.8 Flash", () => {
    expect(resolveGeminiWebModel("").id).toBe("gemini-3.8-flash");
  });

  it("resolves each shipped model to a server-side hex", () => {
    expect(resolveGeminiWebModel("gemini-3.1-pro").hexID).toBe("e6fa609c3fa255c0");
    expect(resolveGeminiWebModel("gemini-3.8-flash").hexID).toBe("56fdd199312815e2");
    expect(resolveGeminiWebModel("gemini-3.5-flash-lite").hexID).toBe("8c46e95b1a07cecc");
    expect(resolveGeminiWebModel("gemini-4-argon").hexID).toBe("95a4c0abcba24364");
  });

  it("resolves active hexes directly to their corresponding models", () => {
    expect(resolveGeminiWebModel(HEX.flashLite).id).toBe("gemini-3.5-flash-lite");
    expect(resolveGeminiWebModel(HEX.flashLite).hexID).toBe(HEX.flashLite);

    expect(resolveGeminiWebModel(HEX.flash).id).toBe("gemini-3.8-flash");
    expect(resolveGeminiWebModel(HEX.flash).hexID).toBe(HEX.flash);

    expect(resolveGeminiWebModel(HEX.pro).id).toBe("gemini-3.1-pro");
    expect(resolveGeminiWebModel(HEX.pro).hexID).toBe(HEX.pro);

    expect(resolveGeminiWebModel(HEX.argon).id).toBe("gemini-4-argon");
    expect(resolveGeminiWebModel(HEX.argon).hexID).toBe(HEX.argon);

    // Active hexes with -thinking
    expect(resolveGeminiWebModel(`${HEX.flashLite}-thinking`).id).toBe("gemini-3.5-flash-lite-thinking");
    expect(resolveGeminiWebModel(`${HEX.flashLite}-thinking`).thinking).toBe(true);
  });

  it("keeps the previous hexes resolving to their replacement", () => {
    expect(resolveGeminiWebModel("9d8ca3786ebdfbea").id).toBe("gemini-3.1-pro");
    expect(resolveGeminiWebModel("cf41b0e0dd7d53e5").id).toBe("gemini-3.5-flash-lite");
    expect(resolveGeminiWebModel("fbb127bbb056c959").id).toBe("gemini-3.8-flash");
  });

  it("treats 3.7 as an alias of 3.8 (same hex)", () => {
    expect(resolveGeminiWebModel("gemini-3.7-flash").hexID).toBe(
      resolveGeminiWebModel("gemini-3.8-flash").hexID
    );
  });

  it("resolves shorthand aliases and family names", () => {
    expect(resolveGeminiWebModel("flash").id).toBe("gemini-3.8-flash");
    expect(resolveGeminiWebModel("flash").hexID).toBe(HEX.flash);

    expect(resolveGeminiWebModel("pro").id).toBe("gemini-3.1-pro");
    expect(resolveGeminiWebModel("pro").hexID).toBe(HEX.pro);

    expect(resolveGeminiWebModel("flash-lite").id).toBe("gemini-3.5-flash-lite");
    expect(resolveGeminiWebModel("flash-lite").hexID).toBe(HEX.flashLite);

    expect(resolveGeminiWebModel("argon").id).toBe("gemini-4-argon");
    expect(resolveGeminiWebModel("argon").hexID).toBe(HEX.argon);

    // Shorthand thinking
    expect(resolveGeminiWebModel("flash-thinking").id).toBe("gemini-3.8-flash-thinking");
    expect(resolveGeminiWebModel("flash-thinking").thinking).toBe(true);

    expect(resolveGeminiWebModel("pro-thinking").id).toBe("gemini-3.1-pro-thinking");
    expect(resolveGeminiWebModel("pro-thinking").thinking).toBe(true);

    // Colon thinking syntax :thinking
    expect(resolveGeminiWebModel("gemini-3.8-flash:thinking").id).toBe("gemini-3.8-flash-thinking");
    expect(resolveGeminiWebModel("gemini-3.8-flash:thinking").thinking).toBe(true);
  });

  it("strips provider prefix like gemini-web/ and gweb/", () => {
    expect(resolveGeminiWebModel("gemini-web/gemini-3.8-flash").id).toBe("gemini-3.8-flash");
    expect(resolveGeminiWebModel("gemini-web/gemini-3.8-flash").hexID).toBe(HEX.flash);

    expect(resolveGeminiWebModel("gweb/pro").id).toBe("gemini-3.1-pro");
    expect(resolveGeminiWebModel("gweb/pro").hexID).toBe(HEX.pro);

    expect(resolveGeminiWebModel("gemini-cookie/gemini-4-argon-thinking").id).toBe("gemini-4-argon-thinking");
    expect(resolveGeminiWebModel("gemini-cookie/gemini-4-argon-thinking").thinking).toBe(true);
  });

  it("resolves passthrough model names with keyword inference", () => {
    expect(resolveGeminiWebModel("gemini-3.1-pro-preview").hexID).toBe(HEX.pro);
    expect(resolveGeminiWebModel("gemini-2.5-flash").hexID).toBe(HEX.flash);
    expect(resolveGeminiWebModel("gemini-2.5-pro").hexID).toBe(HEX.pro);
    expect(resolveGeminiWebModel("gemini-2.5-pro-thinking").thinking).toBe(true);
  });

  it("accepts raw 16-hex string passthrough", () => {
    const raw = "1122334455667788";
    const cfg = resolveGeminiWebModel(raw);
    expect(cfg.hexID).toBe(raw);
    expect(cfg.rawHex).toBe(true);
  });

  it("marks -thinking variants as thinking, base models as not", () => {
    expect(resolveGeminiWebModel("gemini-3.8-flash-thinking").thinking).toBe(true);
    expect(resolveGeminiWebModel("gemini-3.8-flash").thinking).toBe(false);
  });

  it("gates pro/argon behind a cookie, leaves flash-lite open", () => {
    expect(resolveGeminiWebModel("gemini-3.1-pro").needsCookie).toBe(true);
    expect(resolveGeminiWebModel("gemini-3.5-flash-lite").needsCookie).toBe(false);
  });

  it("selects argon by mode 8", () => {
    expect(resolveGeminiWebModel("gemini-4-argon").mode).toBe(8);
  });

  it("sends no model header for an unknown model", () => {
    const cfg = resolveGeminiWebModel("no-such-model");
    expect(cfg.hexID).toBe("");
    expect(buildModelHeader(cfg.hexID, 1, 1, "x")).toBe("");
  });
});

describe("gemini-web model header", () => {
  it("carries hex, mode, thinking and uuid", () => {
    const h = buildModelHeader("fbb127bbb056c959", 1, 2, "u-1");
    expect(h).toContain('fbb127bbb056c959');
    expect(h).toContain(',1,2,"u-1"]');
    expect(h).toMatch(/^\[1,null,null,null,"[^"]+",null,null,0,\[4,5,6,8\]/);
  });

  it("falls back to the minimal form without a uuid", () => {
    expect(buildModelHeader("abc", 1, 1, "")).toBe('[1,null,null,null,"abc"]');
  });
});

describe("gemini-web inner payload", () => {
  it("has the browser's slot count", () => {
    expect(JSON.parse(buildInnerPayload("x", {})).length).toBe(97);
  });

  it("places prompt, mode, thinking and uuid in the captured slots", () => {
    const inner = JSON.parse(buildInnerPayload("halo", { mode: 8, thinking: true, uuid: "r1" }));
    expect(JSON.stringify(inner[0])).toContain("halo");
    expect(inner[79]).toBe(8);
    expect(inner[80]).toBe(2);
    expect(inner[96]).toBe(1);
    expect(inner[59]).toBe("r1");
    expect(inner[41]).toEqual([1]);
  });

  it("uses the normal thinking value when thinking is off", () => {
    const inner = JSON.parse(buildInnerPayload("x", { mode: 1, thinking: false, uuid: "r" }));
    expect(inner[80]).toBe(1);
    expect(inner[96]).toBe(0);
  });
});

describe("gemini-web SAPISID hash", () => {
  it("matches the SAPISIDHASH <ts>_<sha1> shape", () => {
    expect(makeSapisidHash(1700000000, "abc")).toMatch(
      /^SAPISIDHASH 1700000000_[0-9a-f]{40}$/
    );
  });
});

describe("web-cookie tool bridge", () => {
  const body = {
    messages: [{ role: "user", content: "list files" }],
    tools: [
      {
        type: "function",
        function: {
          name: "run_command",
          description: "run",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
          },
        },
      },
    ],
  };

  it("detects the tools array", () => {
    expect(hasTools(body)).toBe(true);
    expect(hasTools({ messages: [] })).toBe(false);
  });

  it("builds instructions carrying the schema and fence", () => {
    const i = buildToolInstructions(body, "marker");
    expect(i).toContain("run_command");
    expect(i).toContain("<<TOOL_CALL>>");
    expect(buildToolInstructions(body, "fenced")).toContain("```tool_call");
  });

  it("honours a forced tool_choice function name", () => {
    const i = buildToolInstructions(
      { tool_choice: { type: "function", function: { name: "run_command" } }, tools: body.tools },
      "marker"
    );
    expect(i).toContain('MUST call the tool "run_command"');
  });

  it("reminds the model that a code block is not an execution channel", () => {
    expect(buildToolReminder("marker")).toContain("code block is NOT executed");
  });

  it("assembles the prompt with instructions, question and reminder", () => {
    const p = buildPromptWithTools([{ role: "user", content: "list files" }], body);
    expect(p.toolMode).toBe(true);
    expect(p.prompt).toContain("```tool_call");
    expect(p.prompt).toContain("list files");
    expect(p.prompt).toContain("highest priority");
    expect(buildPromptWithTools([{ role: "user", content: "hi" }], { messages: [] }).toolMode).toBe(
      false
    );
  });

  it("parses a fenced tool call out of a reply", () => {
    const r = parseToolCallReply(
      'here you go\n```tool_call\n{"name": "run_command", "arguments": {"command": "ls"}}\n```'
    );
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].name).toBe("run_command");
    expect(r.calls[0].arguments.command).toBe("ls");
    expect(r.content).not.toContain("tool_call");
  });

  it("parses the marker style too", () => {
    const r = parseToolCallReply(
      'ok <<TOOL_CALL>> {"name": "read", "arguments": {"p": "a"}} <<TOOL_CALL>> done'
    );
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].name).toBe("read");
  });

  it("returns plain content untouched when there is no call", () => {
    const r = parseToolCallReply("just a normal answer");
    expect(r.calls).toHaveLength(0);
    expect(r.content).toBe("just a normal answer");
  });

  it("tolerates a trailing comma", () => {
    const r = parseToolCallReply('run it\n{"name": "x", "arguments": {"a": 1,}}');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].arguments.a).toBe(1);
  });
});

describe("gemini-web prompt construction", () => {
  it("extracts text from structured message content arrays without throwing 400", () => {
    const messages = [
      { role: "system", content: [{ type: "text", text: "You are helpful." }] },
      { role: "user", content: [{ type: "text", text: "Hello from parts!" }] },
    ];
    const prompt = buildPromptWithTools(messages, { messages }).prompt;
    expect(prompt).toContain("You are helpful.");
    expect(prompt).toContain("Hello from parts!");
  });
});

describe("gemini-web executor input validation", () => {
  const executor = new GeminiWebExecutor();

  it("returns 401 when cookies are missing", async () => {
    const res = await executor.execute({
      model: "gemini-3.8-flash",
      body: { messages: [{ role: "user", content: "hello" }] },
      credentials: {},
    });
    expect(res.response.status).toBe(401);
  });

  it("returns 400 when prompt and user message are empty", async () => {
    const res = await executor.execute({
      model: "gemini-3.8-flash",
      body: { messages: [{ role: "user", content: "   " }] },
      credentials: { apiKey: "__Secure-1PSID=fake-psid" },
    });
    expect(res.response.status).toBe(400);
    const data = await res.response.json();
    expect(data.error.message).toContain("No user message found");
  });

  it("accepts top-level body.prompt string instead of messages", async () => {
    // If prompt is valid, it proceeds past prompt validation to session fetching (which fails with fake cookie -> 401 or 502)
    const res = await executor.execute({
      model: "gemini-3.8-flash",
      body: { prompt: "Hello Gemini" },
      credentials: { apiKey: "__Secure-1PSID=fake-psid" },
    });
    // Should NOT be 400 "No user message found"
    expect(res.response.status).not.toBe(400);
  });
});

describe("gemini-web response parsing", () => {
  it("strips code execution artifacts", () => {
    expect(cleanGeminiText("```python?code_reference&code_event_index=1\nprint(1)\n```\nhello")).toBe(
      "hello"
    );
  });

  it("returns empty reasoning when there is no wrb.fr stream", () => {
    expect(parseStreamReasoning("hello world")).toBe("");
  });
});

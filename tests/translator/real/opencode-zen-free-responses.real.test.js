// REAL: zero-cost responses-path smoke on OpenCode Zen's free tier.
//
// After the OpenCode Go subscription lapsed, the DeepSeek go-lane evidence
// matrix could no longer be re-run. Zen's free tier keeps a responses-native
// model (muse-spark-1.3-contributor-free) reachable at no cost, so the
// responses 直通 path through 9router stays continuously testable: transport
// selection, executor free-tier fingerprint, SSE lifecycle and input replay.
// DeepSeek-specific semantics (thinking pass-back) still require the go lane
// or the official API and stay in the opencode-go / deepseek real suites.
//
// The free tier only accepts requests carrying the client fingerprint
// (opencode UA + session header + stream:true + bash/glob/grep/read quartet);
// the opencode-zen executor injects all of it, which is part of what this
// smoke verifies.
//
//   OPENCODE_ZEN_KEY=oc_sk... RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/opencode-zen-free-responses.real.test.js
//
// (OPENCODE_ZEN_KEY overrides credential lookup; otherwise an opencode-zen
// connection must be configured in 9router.)
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const ENV_KEY = process.env.OPENCODE_ZEN_KEY || "";
const PROVIDER = "opencode-zen";
const MODEL = "muse-spark-1.3-contributor-free";
const TIMEOUT_MS = 120000;

async function prepare() {
  if (ENV_KEY) return { accessToken: ENV_KEY };
  const creds = await getProviderCredentials(PROVIDER, new Set(), MODEL);
  if (!creds || creds.allRateLimited) return null;
  return checkAndRefreshToken(PROVIDER, creds);
}

async function runResponses(body, creds) {
  const result = await handleChatCore({
    body: { ...body, model: `${PROVIDER}/${MODEL}` },
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: creds,
    connectionId: creds.connectionId,
    sourceFormatOverride: "openai-responses",
  });
  if (!result.success) {
    return {
      ok: false,
      status: Number(result.status) || "n/a",
      raw: String(result.error || ""),
    };
  }
  return { ok: true, status: 200, raw: await drainSSE(result.response) };
}

async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function sseEvents(raw) {
  const events = [];
  for (const chunk of raw.split("\n\n")) {
    const line = chunk.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      /* skip malformed */
    }
  }
  return events;
}

function userInput(text) {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

const WEATHER_TOOL = {
  type: "function",
  name: "get_weather",
  description: "Get weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

describe.skipIf(!RUN_REAL)(`REAL zen free responses 直通 (${MODEL})`, () => {
  it(
    "streams a full Responses SSE lifecycle through the executor fingerprint",
    async () => {
      const creds = await prepare();
      if (!creds) return;

      const res = await runResponses(
        {
          input: [userInput("Say OK and nothing else.")],
          // 256 headroom: the default reasoning effort burns most of a small
          // cap and the stream ends response.incomplete, not completed.
          max_output_tokens: 256,
          stream: true,
        },
        creds,
      );
      expect(res.ok).toBe(true);

      const types = sseEvents(res.raw).map((e) => e.type);
      expect(types).toContain("response.created");
      expect(types).toContain("response.completed");
    },
    TIMEOUT_MS,
  );

  it(
    "accepts custom tools alongside the fingerprint quartet",
    async () => {
      const creds = await prepare();
      if (!creds) return;

      const res = await runResponses(
        {
          input: [userInput("What is the weather in Paris? Use the tool.")],
          max_output_tokens: 256,
          stream: true,
          tools: [WEATHER_TOOL],
        },
        creds,
      );
      expect(res.ok).toBe(true);
      expect(sseEvents(res.raw).map((e) => e.type)).toContain(
        "response.completed",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "replays turn-1 output items (incl. reasoning) as input for turn 2",
    async () => {
      const creds = await prepare();
      if (!creds) return;

      const turn1 = await runResponses(
        {
          input: [
            userInput("Think briefly, then reply with the single word OK."),
          ],
          max_output_tokens: 256,
          stream: true,
        },
        creds,
      );
      expect(turn1.ok).toBe(true);
      const completed = sseEvents(turn1.raw).find(
        (e) => e.type === "response.completed",
      );
      const output = completed?.response?.output;
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBeGreaterThan(0);

      // Replay every output item verbatim (reasoning items included) — the
      // input-array pass-back path responses clients depend on.
      const turn2 = await runResponses(
        {
          input: [
            userInput("Think briefly, then reply with the single word OK."),
            ...output,
            userInput("Now reply with the single word DONE."),
          ],
          max_output_tokens: 256,
          stream: true,
        },
        creds,
      );
      expect(turn2.ok).toBe(true);
      expect(sseEvents(turn2.raw).map((e) => e.type)).toContain(
        "response.completed",
      );
    },
    TIMEOUT_MS,
  );
});

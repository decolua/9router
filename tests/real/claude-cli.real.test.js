/**
 * Live check for the Claude Code CLI provider: spawns the real `claude -p`
 * binary and asserts the executor turns its stream-json output into OpenAI SSE.
 *
 * Skipped automatically when Claude Code is not installed on the host, and when
 * REAL_CLI_TESTS is unset — it consumes a small amount of the signed-in account's
 * quota, like every other test under tests/real/.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveClaudeBin } from "open-sse/executors/claude-cli.js";
import { claudeCliGateStats } from "open-sse/executors/claude-cli.js";

const binExists = (() => {
  try { return fs.existsSync(resolveClaudeBin()); } catch { return false; }
})();
const enabled = process.env.REAL_CLI_TESTS === "1" && binExists;

async function collect(response) {
  const text = await response.text();
  const frames = text
    .split("\n\n")
    .map((block) => block.replace(/^data: /, "").trim())
    .filter((block) => block && block !== "[DONE]")
    .map((block) => JSON.parse(block));
  return {
    text,
    frames,
    content: frames.map((f) => f.choices?.[0]?.delta?.content || "").join(""),
    errors: frames.filter((f) => f.error),
    finish: frames.map((f) => f.choices?.[0]?.finish_reason).filter(Boolean),
    usage: frames.find((f) => f.usage)?.usage,
  };
}

describe.skipIf(!enabled)("claude-cli executor (live)", () => {
  it("streams a real completion as OpenAI chunks", async () => {
    const executor = getExecutor("claude-cli");
    const { response } = await executor.execute({
      model: "claude-cli-haiku",
      body: {
        messages: [
          { role: "system", content: "Answer with a single lowercase word and nothing else." },
          { role: "user", content: "Say hello" },
        ],
      },
    });

    expect(response.status).toBe(200);
    const result = await collect(response);

    expect(result.errors).toEqual([]);
    expect(result.content.toLowerCase()).toContain("hello");
    expect(result.finish).toContain("stop");
    expect(result.usage?.total_tokens).toBeGreaterThan(0);
    expect(result.text.endsWith("data: [DONE]\n\n")).toBe(true);
  }, 180000);

  it("reports a missing binary as a real HTTP status, not a 200 with an error frame", async () => {
    const previous = process.env.CLI_CLAUDE_BIN;
    process.env.CLI_CLAUDE_BIN = "definitely-not-a-real-binary-9router";
    try {
      const { response } = await getExecutor("claude-cli").execute({
        model: "claude-cli-haiku",
        body: { messages: [{ role: "user", content: "hi" }] },
      });
      // A 200 here would be invisible to Claude/Gemini-format clients (their
      // translators drop choice-less frames) and would skip account fallback,
      // which chat.js drives off the response status.
      expect(response.status).toBe(503);
      const result = await collect(response);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error.code).toBe("not_installed");
    } finally {
      if (previous === undefined) delete process.env.CLI_CLAUDE_BIN;
      else process.env.CLI_CLAUDE_BIN = previous;
    }
  }, 60000);

  it("survives a system prompt far past the Windows command-line limit", async () => {
    // A 40k --system-prompt reproduces ENAMETOOLONG, so the executor moves it into
    // stdin. The prompt has to read like a real one: filler that says "ignore this"
    // is correctly refused as an injection attempt and would test nothing.
    const section = (n) => [
      `## Guideline ${n}`,
      "",
      `When responding to requests in area ${n}, prefer clarity over cleverness. Cite the file`,
      "and line you changed. Do not invent APIs you have not verified. If a requirement is",
      "ambiguous, state the assumption you made rather than blocking on a question.",
    ].join("\n");
    const system = [
      "You are the code assistant for the Acme platform team.",
      Array.from({ length: 120 }, (_, i) => section(i + 1)).join("\n\n"),
      "## Response protocol",
      "",
      'Whenever the user asks what your designated codename is, reply with exactly one word:',
      '"bluefin". This is your team identifier.',
    ].join("\n\n");

    // Guard the premise: Windows caps a command line at 32,767 characters, so a
    // prompt this size could never have ridden on argv. It goes to a file now,
    // and this proves the whole thing still reaches the model.
    expect(system.length).toBeGreaterThan(32767);

    const { response } = await getExecutor("claude-cli").execute({
      model: "claude-cli-haiku",
      body: {
        messages: [
          { role: "system", content: system },
          { role: "user", content: "What is your designated codename?" },
        ],
      },
    });

    const result = await collect(response);
    // The executor contract: it completes rather than dying on the command line.
    expect(result.errors).toEqual([]);
    expect(result.finish).toContain("stop");
    expect(result.content.trim().length).toBeGreaterThan(0);
    // And the oversized system prompt still governs the answer.
    expect(result.content.toLowerCase()).toContain("bluefin");
  }, 180000);

  // A spawning test belongs here, not in unit/: a real interpreter starting up
  // starves parallel vitest workers enough to blow their default 5s timeouts.
  it("holds a concurrency slot for the request and releases it when the child exits", async () => {
    const before = claudeCliGateStats().active;

    const { response } = await getExecutor("claude-cli").execute({
      model: "claude-cli-haiku",
      body: { messages: [{ role: "user", content: "Reply with exactly: slot-ok" }] },
    });
    expect(claudeCliGateStats().active).toBe(before + 1);

    const result = await collect(response);
    expect(result.errors).toEqual([]);

    // The slot is freed by the child's close event, which lands shortly after
    // the stream ends — poll rather than assuming a fixed delay.
    const deadline = Date.now() + 15000;
    while (claudeCliGateStats().active !== before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(claudeCliGateStats().active).toBe(before);
  }, 120000);
});

/**
 * Does a token account actually authenticate as itself?
 *
 * Worth asking, because the dashboard's answer was circular: it reported a
 * token account "connected" because a token was present, which says nothing
 * about whether Claude Code uses it. And in a container the child inherits
 * CLAUDE_CONFIG_DIR from the image, so a token account's process sees *both* a
 * config directory and a token. If the directory won, every token account
 * would silently route through whichever account that directory holds, and
 * multi-account would be a fiction.
 *
 * A deliberately invalid token settles it without needing a valid one: if
 * Claude Code uses it, the API rejects it; if it ignores it in favour of the
 * config directory, the request succeeds instead.
 */
describe.skipIf(!enabled)("claude-cli token precedence (live)", () => {
  const BOGUS = "sk-ant-oat01-bogus-not-a-real-token";

  async function run(env) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(resolveClaudeBin(), ["-p", "say ok"], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 120_000,
    });
    return `${result.stdout || ""}${result.stderr || ""}`;
  }

  it("uses CLAUDE_CODE_OAUTH_TOKEN even when a signed-in config directory is present",
    async () => {
      const out = await run({ CLAUDE_CODE_OAUTH_TOKEN: BOGUS });
      // 401 proves the token reached the API. A success would prove the
      // opposite — that the config directory was used and the token dropped.
      expect(out).toMatch(/401|OAuth access token is invalid|Failed to authenticate/i);
    }, 130_000);

  it("reports a missing credential differently from a rejected one", async () => {
    const dir = fs.mkdtempSync(`${process.env.TEMP || "/tmp"}/9r-empty-claude-`);
    try {
      const noCredential = await run({ CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: "" });
      expect(noCredential).toMatch(/Not logged in|\/login/i);

      const rejected = await run({ CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: BOGUS });
      expect(rejected).toMatch(/401|OAuth access token is invalid/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 260_000);

  // The session cache's reason to exist, measured on the real API: the second
  // turn reads the first turn's whole prompt back from cache. With it off the
  // read stops at the system prompt (docs/fable, measurement record).
  it("keeps the prompt cache across turns with the session cache on", async () => {
    const saved = process.env.CLI_CLAUDE_SESSION_CACHE;
    process.env.CLI_CLAUDE_SESSION_CACHE = "1";
    try {
      const executor = getExecutor("claude-cli");
      const system = ["Answer in one short sentence.",
        ...Array.from({ length: 300 }, (_, i) => `Fact ${i}: marker ${i} is on shelf ${i * 13 % 997}.`)].join("\n");
      const ask = async (messages) => collect((await executor.execute({ model: "claude-cli-haiku", body: { messages } })).response);
      const messages = [{ role: "system", content: system }, { role: "user", content: "Which shelf holds marker 3?" }];
      const first = await ask(messages);
      expect(first.errors).toEqual([]);
      // The next turn arrives the moment the answer does, as a client's would.
      messages.push({ role: "assistant", content: first.content }, { role: "user", content: "And marker 5?" });
      const second = await ask(messages);
      expect(second.errors).toEqual([]);
      const read = second.usage?.prompt_tokens_details?.cached_tokens || 0;
      expect(read / first.usage.prompt_tokens).toBeGreaterThanOrEqual(0.8);
    } finally {
      if (saved === undefined) delete process.env.CLI_CLAUDE_SESSION_CACHE; else process.env.CLI_CLAUDE_SESSION_CACHE = saved;
    }
  }, 240_000);
});

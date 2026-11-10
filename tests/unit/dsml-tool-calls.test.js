import { describe, it, expect } from "vitest";
import {
  parseDsmlToolCalls,
  containsDsmlToolCall,
  createDsmlStreamState,
} from "../../open-sse/utils/dsmlToolCalls.js";

// Verbatim shape from the reported failure: spaced ASCII delimiter, closers
// written as `< / | DSML | ...>`, and a mix of string="true" / string="false".
const SCREENSHOT =
  `< | DSML | calls> < | DSML | invoke name="pwsh">` +
  `< | DSML | parameter name="command" string="true">env:GIT_TERMINAL_PROMPT='0' git -c http.sslBackend=openssl clone https://github.com/ctdoteam1110/ctdozlite.git ctdozlite 2>&1 "EXIT=$LASTEXITCODE"< / | DSML | parameter>` +
  `< | DSML | parameter name="description" string="true">Clone repo into workspace< / | DSML | parameter>` +
  `< | DSML | parameter name="timeoutMs" string="false">600000< / | DSML | parameter>` +
  `< / | DSML | invoke> < / | DSML | calls>`;

describe("parseDsmlToolCalls", () => {
  it("parses the reported spaced-delimiter block", () => {
    const { content, toolCalls } = parseDsmlToolCalls(SCREENSHOT);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("pwsh");
    expect(toolCalls[0].arguments.command).toContain("http.sslBackend=openssl");
    expect(toolCalls[0].arguments.description).toBe("Clone repo into workspace");
    expect(content).toBe("");
  });

  it("keeps string=\"true\" verbatim and JSON-parses string=\"false\"", () => {
    const { toolCalls } = parseDsmlToolCalls(SCREENSHOT);
    expect(toolCalls[0].arguments.timeoutMs).toBe(600000);
    expect(typeof toolCalls[0].arguments.command).toBe("string");
  });

  it("preserves surrounding prose and strips only the tool block", () => {
    const { content, toolCalls } = parseDsmlToolCalls(
      "Cloning now.\n" + SCREENSHOT + "\nDone shortly."
    );
    expect(toolCalls).toHaveLength(1);
    expect(content).toBe("Cloning now.\n\nDone shortly.");
  });

  it("handles the tight ASCII delimiter", () => {
    const text =
      `<|DSML|calls><|DSML|invoke name="bash">` +
      `<|DSML|parameter name="command">ls -la</|DSML|parameter>` +
      `</|DSML|invoke></|DSML|calls>`;
    const { toolCalls, content } = parseDsmlToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({ name: "bash", arguments: { command: "ls -la" } });
    expect(content).toBe("");
  });

  it("handles the full-width delimiter", () => {
    const text =
      `<｜｜DSML｜｜calls><｜｜DSML｜｜invoke name="bash">` +
      `<｜｜DSML｜｜parameter name="command">pwd</｜｜DSML｜｜parameter>` +
      `</｜｜DSML｜｜invoke></｜｜DSML｜｜calls>`;
    const { toolCalls } = parseDsmlToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].arguments.command).toBe("pwd");
  });

  it("parses multiple invokes in one block", () => {
    const text =
      `< | DSML | calls>` +
      `< | DSML | invoke name="a">< | DSML | parameter name="x" string="true">1< / | DSML | parameter>< / | DSML | invoke>` +
      `< | DSML | invoke name="b">< | DSML | parameter name="y" string="true">2< / | DSML | parameter>< / | DSML | invoke>` +
      `< / | DSML | calls>`;
    const { toolCalls } = parseDsmlToolCalls(text);
    expect(toolCalls.map((t) => t.name)).toEqual(["a", "b"]);
    expect(toolCalls[1].arguments.y).toBe("2");
  });

  it("falls back to a JSON body when no parameter tags are present", () => {
    const text = `<|DSML|invoke name="run">{"command":"echo hi"}</|DSML|invoke>`;
    const { toolCalls } = parseDsmlToolCalls(text);
    expect(toolCalls[0].arguments).toEqual({ command: "echo hi" });
  });

  it("leaves malformed argument bodies empty rather than throwing", () => {
    const text = `<|DSML|invoke name="run">{not json}</|DSML|invoke>`;
    const { toolCalls } = parseDsmlToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].arguments).toEqual({});
  });

  it("is a no-op on text without DSML", () => {
    const plain = "Just a normal answer with a <tag> and a | pipe.";
    expect(parseDsmlToolCalls(plain)).toEqual({ content: plain, toolCalls: [] });
    expect(containsDsmlToolCall(plain)).toBe(false);
  });

  it("is a no-op on non-string input", () => {
    expect(parseDsmlToolCalls(null)).toEqual({ content: null, toolCalls: [] });
    expect(parseDsmlToolCalls(undefined)).toEqual({ content: undefined, toolCalls: [] });
  });

  it("does not treat a bare DSML mention as a tool call", () => {
    const text = "The | DSML | marker is used by some models.";
    expect(containsDsmlToolCall(text)).toBe(false);
    expect(parseDsmlToolCalls(text).toolCalls).toEqual([]);
  });
});

describe("createDsmlStreamState", () => {
  const feed = (chunks) => {
    const s = createDsmlStreamState();
    let text = "";
    const calls = [];
    for (const c of chunks) {
      const r = s.push(c);
      text += r.text;
      calls.push(...r.toolCalls);
    }
    const f = s.flush();
    text += f.text;
    calls.push(...f.toolCalls);
    return { text, calls };
  };

  it("reassembles a block split across every byte", () => {
    const { text, calls } = feed(SCREENSHOT.split(""));
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("pwsh");
    expect(calls[0].arguments.timeoutMs).toBe(600000);
    expect(text).toBe("");
  });

  it("forwards prose immediately and emits the call at the closer", () => {
    const { text, calls } = feed(["Hello ", "there.", SCREENSHOT]);
    expect(calls).toHaveLength(1);
    expect(text).toBe("Hello there.");
  });

  it("passes plain text through unchanged", () => {
    const { text, calls } = feed(["plain ", "text ", "with no markers"]);
    expect(text).toBe("plain text with no markers");
    expect(calls).toEqual([]);
  });

  it("releases a lone '<' at flush instead of swallowing it", () => {
    const { text, calls } = feed(["a < b"]);
    expect(text).toBe("a < b");
    expect(calls).toEqual([]);
  });

  it("drops an unterminated DSML block at flush instead of leaking markers", () => {
    const { text } = feed(["before ", '< | DSML | invoke name="x">partial']);
    expect(text).toContain("before");
    // The malformed block is discarded: releasing it verbatim would put raw
    // DSML markers in front of the client.
    expect(text).not.toContain("DSML");
  });

  it("handles two blocks in one stream", () => {
    const one = `<|DSML|invoke name="a"><|DSML|parameter name="x">1</|DSML|parameter></|DSML|invoke>`;
    const { calls } = feed([one, "between", one]);
    expect(calls).toHaveLength(2);
  });
});

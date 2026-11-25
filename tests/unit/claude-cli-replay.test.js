import { describe, it, expect } from "vitest";
import { buildReplayFrames, describeFrames, framesToStdin } from "open-sse/executors/claudeCliReplay.js";
import {
  CLAUDE_CLI_MCP_TOOL_PREFIX,
  CLAUDE_CLI_TRANSCRIPT_MARKERS,
} from "open-sse/config/claudeCli.js";

/**
 * Replaying a conversation as a conversation.
 *
 * `claude -p` takes one prompt, so history used to arrive as a block of text
 * with `[User]` / `[Assistant]` / `[Tool result]` markers — a transcript *about*
 * a conversation rather than one the model had. `--input-format stream-json`
 * takes the real turns, and the CLI accepts the historical ones without calling
 * the model (measured: `num_turns: 0`, zero input tokens).
 */

const PREFIX = CLAUDE_CLI_MCP_TOOL_PREFIX;
const build = (messages) => buildReplayFrames(messages, PREFIX);

describe("buildReplayFrames", () => {
  it("keeps the turns as turns, and asks only with the last one", () => {
    const { frames } = build([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(frames.map((f) => f.type)).toEqual(["user", "assistant", "user"]);
    // History is acknowledged without a model call; only the last frame queries.
    expect(frames[0].shouldQuery).toBe(false);
    expect(frames[1].shouldQuery).toBeUndefined();
    expect(frames[2].shouldQuery).toBeUndefined();
  });

  it("carries content as blocks, not as flattened text", () => {
    const { frames } = build([{ role: "user", content: "hello" }]);
    expect(frames[0].message).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("lifts system and developer messages out of the turns", () => {
    const { system, frames } = build([
      { role: "system", content: "Be terse." },
      { role: "developer", content: "No emoji." },
      { role: "user", content: "hi" },
    ]);
    expect(system).toBe("Be terse.\n\nNo emoji.");
    expect(frames).toHaveLength(1);
  });

  it("replays a proposed call as a tool_use block, under the name the CLI knows", () => {
    const { frames } = build([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "toolu_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Seoul"}' },
        }],
      },
      { role: "tool", tool_call_id: "toolu_1", content: '{"temp_c":21}' },
    ]);
    expect(frames[1].message.content).toEqual([{
      type: "tool_use",
      id: "toolu_1",
      // Re-namespaced: the model proposed it under the MCP name, and replaying
      // the caller's name would name a tool that never existed in this turn.
      name: `${PREFIX}get_weather`,
      input: { city: "Seoul" },
    }]);
  });

  it("does not namespace a name that already carries the prefix", () => {
    const { frames } = build([
      { role: "user", content: "x" },
      {
        role: "assistant",
        tool_calls: [{ id: "t", function: { name: `${PREFIX}get_weather`, arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "t", content: "{}" },
    ]);
    expect(frames[1].message.content[0].name).toBe(`${PREFIX}get_weather`);
  });

  it("survives unparseable tool arguments instead of losing the turn", () => {
    const { frames } = build([
      { role: "user", content: "x" },
      { role: "assistant", tool_calls: [{ id: "t", function: { name: "f", arguments: "{oops" } }] },
      { role: "tool", tool_call_id: "t", content: "{}" },
    ]);
    expect(frames[1].message.content[0].input).toEqual({});
  });

  it("answers an assistant's calls in one user turn, not several", () => {
    const { frames } = build([
      { role: "user", content: "x" },
      {
        role: "assistant",
        tool_calls: [
          { id: "a", function: { name: "f", arguments: "{}" } },
          { id: "b", function: { name: "g", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "1" },
      { role: "tool", tool_call_id: "b", content: "2" },
    ]);
    // Two results, one turn: they answer a single assistant message, and
    // splitting them would claim a turn that never happened.
    expect(frames).toHaveLength(3);
    expect(frames[2].message.content).toEqual([
      { type: "tool_result", tool_use_id: "a", content: "1" },
      { type: "tool_result", tool_use_id: "b", content: "2" },
    ]);
  });

  it("keeps a structured tool result as blocks, image and all", () => {
    // An agent that returns a screenshot with its text sends a list.
    // Stringifying it put JSON punctuation in front of the model and lost the
    // image entirely.
    const { frames } = build([
      { role: "user", content: "x" },
      { role: "assistant", tool_calls: [{ id: "t1", function: { name: "f", arguments: "{}" } }] },
      {
        role: "tool",
        tool_call_id: "t1",
        content: [
          { type: "text", text: "done" },
          { type: "image_url", image_url: { url: "data:image/png;base64,QQ==" } },
        ],
      },
    ]);
    expect(frames[2].message.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: [
        { type: "text", text: "done" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "QQ==" } },
      ],
    });
  });

  it("keeps a plain string result a string", () => {
    const { frames } = build([
      { role: "user", content: "x" },
      { role: "assistant", tool_calls: [{ id: "t1", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "plain" },
    ]);
    expect(frames[2].message.content[0].content).toBe("plain");
  });

  it("falls back to the original when a list holds nothing readable", () => {
    // Better an honest JSON string than an empty result the model reads as
    // "the tool returned nothing".
    const { frames } = build([
      { role: "user", content: "x" },
      { role: "assistant", tool_calls: [{ id: "t1", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: [{ type: "weird" }] },
    ]);
    expect(frames[2].message.content[0].content).toBe('[{"type":"weird"}]');
  });

  it("passes Claude-dialect tool blocks straight through", () => {
    const { frames } = build([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "z", content: "done" }] },
    ]);
    expect(frames[0].message.content).toEqual([
      { type: "tool_result", tool_use_id: "z", content: "done" },
    ]);
  });

  it("carries an image through, instead of dropping it into the text", () => {
    // Verified against the real CLI: an image block over stream-json is read by
    // the model. Before this, an attachment simply vanished and the caller was
    // told nothing.
    const { frames } = build([{
      role: "user",
      content: [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      ],
    }]);
    // Source order is preserved: an image referred to as "the first one" has to
    // still be the first one.
    expect(frames[0].message.content).toEqual([
      { type: "text", text: "describe" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
    ]);
  });

  it("hands a remote image over as a url source rather than swallowing it", () => {
    const { frames } = build([{
      role: "user",
      content: [{ type: "image_url", image_url: { url: "https://example.test/cat.png" } }],
    }]);
    expect(frames[0].message.content).toEqual([
      { type: "image", source: { type: "url", url: "https://example.test/cat.png" } },
    ]);
  });

  it("passes a Claude-dialect image or document straight through", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "eA==" } };
    const doc = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "eA==" } };
    const { frames } = build([{ role: "user", content: [image, doc] }]);
    expect(frames[0].message.content).toEqual([image, doc]);
  });

  it("declines a conversation that ends on the assistant, so the caller flattens it", () => {
    // There would be nothing to query with: the last frame has to be a turn the
    // model is being asked to answer.
    expect(build([{ role: "user", content: "x" }, { role: "assistant", content: "y" }]).frames)
      .toBeNull();
  });

  it("declines an empty conversation", () => {
    expect(build([]).frames).toBeNull();
    expect(build(undefined).frames).toBeNull();
    // A system prompt alone is not something to ask.
    expect(build([{ role: "system", content: "rules" }]).frames).toBeNull();
  });

  it("skips a message with nothing in it rather than sending an empty turn", () => {
    const { frames } = build([
      { role: "user", content: "" },
      { role: "user", content: "real" },
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0].message.content[0].text).toBe("real");
  });
});

describe("framesToStdin", () => {
  it("writes one JSON document per line, newline-terminated", () => {
    const { frames } = build([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }]);
    const text = framesToStdin(frames);
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(text.endsWith("\n")).toBe(true);
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(["user", "assistant", "user"]);
  });

  it("emits no raw newline inside a line, which would split one frame into two", () => {
    const { frames } = build([{ role: "user", content: "line one\nline two" }]);
    expect(framesToStdin(frames).split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("describeFrames", () => {
  // Recorded with every request so a client that loops can be diagnosed from
  // the dashboard rather than from a guess. It is the shape of the
  // conversation, never its contents.
  const conversation = () => build([
    { role: "user", content: "go" },
    {
      role: "assistant",
      tool_calls: [
        { id: "A", function: { name: "f", arguments: "{}" } },
        { id: "B", function: { name: "g", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "A", content: "ok" },
    { role: "tool", tool_call_id: "GHOST", content: "stray" },
    { role: "user", content: "next" },
  ]).frames;

  it("counts the turns and the calls", () => {
    const shape = describeFrames(conversation());
    expect(shape.turns).toBe(4);
    expect(shape.toolCalls).toBe(2);
  });

  it("names a result whose call never happened", () => {
    // Upstream rejects that pairing, and it is the shape a client gets into
    // after a provider drops a call.
    expect(describeFrames(conversation()).orphanResults).toEqual(["GHOST"]);
  });

  it("names a call that nothing answered", () => {
    expect(describeFrames(conversation()).unansweredCalls).toEqual(["B"]);
  });

  it("describes blocks without copying their text", () => {
    const shape = describeFrames(conversation());
    const last = shape.lastTurns.at(-1);
    expect(last).toEqual({ role: "user", blocks: ["text(4)"] });
    expect(JSON.stringify(shape)).not.toContain("stray");
  });

  it("flags a turn carrying the flattened transcript's own syntax", () => {
    // A model that reads it imitates it; it should never reach a replayed turn.
    const { frames } = build([{ role: "user", content: "[Tool call ls id=c1] and so on" }]);
    expect(describeFrames(frames).lastTurns[0].blocks[0]).toContain("CONTAINS-TRANSCRIPT-MARKER");
  });

  it("flags the prose form the flattener writes today, not only the old brackets", () => {
    // The detector was pinned to `[Tool call ` after the flattener had moved to
    // prose, so it matched nothing any current code produces. Both forms count:
    // the bracketed one still comes from the other CLI providers, and a client
    // sends either back as history.
    for (const marker of CLAUDE_CLI_TRANSCRIPT_MARKERS) {
      const { frames } = build([{ role: "user", content: `${marker}something) and so on` }]);
      expect(describeFrames(frames).lastTurns[0].blocks[0], marker)
        .toContain("CONTAINS-TRANSCRIPT-MARKER");
    }
  });

  it("says nothing for a conversation that was not replayed", () => {
    expect(describeFrames(null)).toBeNull();
    expect(describeFrames([])).toBeNull();
  });
});

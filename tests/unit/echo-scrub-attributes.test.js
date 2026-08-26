// A harness tag opened WITH ATTRIBUTES.
//
// Both filters compared against the literal "<tag>", so a model that opened
// `<task-notification task_id="a424703057daa789f">` walked straight through:
// the tag was in ECHO_TAGS and the filter ran, but nothing matched and the whole
// block reached the client as visible text. Observed in session 953c125e.

import { describe, it, expect } from "vitest";
import { stripEchoTags } from "../../open-sse/utils/echoScrub.js";
import { filterEchoText, flushEchoText } from "../../open-sse/translator/response/openai-to-claude.js";

const feed = (chunks) => {
  const state = {};
  let out = "";
  for (const c of chunks) out += filterEchoText(state, c);
  out += flushEchoText(state) || "";
  return out;
};

describe("stripEchoTags with attributes", () => {
  it("drops the block that leaked in session 953c125e", () => {
    expect(stripEchoTags(
      'before<task-notification task_id="a424703057daa789f">noise</task-notification>after',
    )).toBe("beforeafter");
  });

  it("still drops the bare tag", () => {
    expect(stripEchoTags("a<system-reminder>x</system-reminder>b")).toBe("ab");
  });

  it("drops an unclosed attributed block to end of text", () => {
    expect(stripEchoTags('keep<task-notification id="1">tail')).toBe("keep");
  });

  it("handles several attributes and single quotes", () => {
    expect(stripEchoTags("<instructions a='1' b=\"2\" c>x</instructions>y")).toBe("y");
  });

  it("does not match a different tag that shares the prefix", () => {
    const s = "<system-reminders>keep me</system-reminders>";
    expect(stripEchoTags(s)).toBe(s);
  });

  it("leaves ordinary angle brackets alone", () => {
    expect(stripEchoTags("if a < b and c > d")).toBe("if a < b and c > d");
  });
});

describe("filterEchoText with attributes", () => {
  it("drops an attributed block arriving in one chunk", () => {
    expect(feed(['real<task-notification task_id="x">noise</task-notification>tail']))
      .toBe("realtail");
  });

  it("drops an attributed block split across chunks", () => {
    expect(feed(["real<task-notif", 'ication task_id="x">noi', "se</task-notification>tail"]))
      .toBe("realtail");
  });

  it("drops one split inside the attribute run", () => {
    expect(feed(["real<task-notification ta", 'sk_id="x">n</task-notification>tail']))
      .toBe("realtail");
  });

  it("drops an attributed block left unclosed at end of stream", () => {
    expect(feed(['real <task-notification id="1">never closed'])).toBe("real ");
  });

  it("still drops the bare tag split across chunks", () => {
    expect(feed(["a<system-rem", "inder>x</system-reminder>b"])).toBe("ab");
  });

  it("does not swallow a tag that only shares the prefix", () => {
    expect(feed(["<system-reminders>keep</system-reminders>"]))
      .toBe("<system-reminders>keep</system-reminders>");
  });

  it("emits an unterminated opening tag as text once it exceeds the bound", () => {
    const long = "<instructions " + "a".repeat(600);
    expect(feed([long])).toBe(long);
  });

  it("leaves ordinary angle brackets alone", () => {
    expect(feed(["1 < 2 and 3 > 2"])).toBe("1 < 2 and 3 > 2");
  });
});

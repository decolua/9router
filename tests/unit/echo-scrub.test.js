import { describe, expect, it } from "vitest";
import { scrubEcho, scrubResponseBody, stripEchoTags } from "../../open-sse/utils/echoScrub.js";

const LONG = "Please review the deployment pipeline and tell me precisely which stage is failing, because the logs are contradictory and I need the real cause.";

describe("stripEchoTags", () => {
  it("removes a whole harness block and keeps the real text", () => {
    expect(stripEchoTags("before<system-reminder>noise</system-reminder>after")).toBe("beforeafter");
  });

  it("removes an unclosed trailing block", () => {
    expect(stripEchoTags("kept<instructions>dangling")).toBe("kept");
  });

  it("removes several blocks of different tags", () => {
    expect(stripEchoTags("a<instructions>x</instructions>b<command-name>y</command-name>c")).toBe("abc");
  });

  it("leaves ordinary text and unrelated angle brackets alone", () => {
    expect(stripEchoTags("if a < b and c > d")).toBe("if a < b and c > d");
    expect(stripEchoTags("<div>keep</div>")).toBe("<div>keep</div>");
  });
});

describe("scrubEcho", () => {
  it("empties a reply that is the user's message repeated back", () => {
    expect(scrubEcho(LONG, LONG)).toBe("");
  });

  it("keeps a genuine answer", () => {
    const answer = "Stage three fails because the image tag is stale; redeploy after pinning it and the pipeline goes green again.";
    expect(scrubEcho(answer, LONG)).toBe(answer);
  });

  it("strips tags even when there is no user text to compare", () => {
    expect(scrubEcho("real<system-reminder>x</system-reminder>", "")).toBe("real");
  });
});

describe("scrubResponseBody", () => {
  it("scrubs an OpenAI chat completion and reports the change", () => {
    const body = { choices: [{ message: { content: "hi<system-reminder>x</system-reminder>" } }] };
    expect(scrubResponseBody(body, "")).toBe(true);
    expect(body.choices[0].message.content).toBe("hi");
  });

  it("scrubs a Claude message body", () => {
    const body = { type: "message", content: [{ type: "text", text: "ok<instructions>x</instructions>" }] };
    expect(scrubResponseBody(body, "")).toBe(true);
    expect(body.content[0].text).toBe("ok");
  });

  it("scrubs gemini candidate parts", () => {
    const body = { candidates: [{ content: { parts: [{ text: "y<command-name>z</command-name>" }] } }] };
    expect(scrubResponseBody(body, "")).toBe(true);
    expect(body.candidates[0].content.parts[0].text).toBe("y");
  });

  it("empties a regurgitated reply and reports the change", () => {
    const body = { choices: [{ message: { content: LONG } }] };
    expect(scrubResponseBody(body, LONG)).toBe(true);
    expect(body.choices[0].message.content).toBe("");
  });

  it("reports no change for a clean body", () => {
    const body = { choices: [{ message: { content: "all good here" } }] };
    expect(scrubResponseBody(body, LONG)).toBe(false);
    expect(body.choices[0].message.content).toBe("all good here");
  });

  it("tolerates junk without throwing", () => {
    expect(scrubResponseBody(null, "x")).toBe(false);
    expect(scrubResponseBody({}, "x")).toBe(false);
    expect(scrubResponseBody({ choices: [{}] }, "x")).toBe(false);
  });
});

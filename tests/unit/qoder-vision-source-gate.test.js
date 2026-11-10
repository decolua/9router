// Vision gate: Qoder only honours image parts when model_config keeps `source`.
//
// Verified against a live account: the same payload with `source: "system"`
// answers "Red" for a red square, without it answers "NOIMAGE". Text requests
// still drop `source`, because that field selects Qoder's managed lane and
// parks text traffic in 10605/queueType=p3 while the lane is busy.
import { describe, expect, it } from "vitest";

import { __test__ } from "../../open-sse/executors/qoder.js";
import { qoderChatModelConfig } from "../../open-sse/shared/qoder/constants.js";

const { buildQoderRequestBody } = __test__;

// Catalog shape: note the absence of `source` — the executor must inject it
// for image requests, since the live catalog never carries it.
const modelConfig = {
  key: "kmodel_latest",
  is_vl: true,
  is_reasoning: false,
  max_input_tokens: 200000,
};

const credentials = {
  accessToken: "jt-test",
  providerSpecificData: { userId: "user-1", machineId: "machine-1" },
};

async function build(content) {
  return buildQoderRequestBody({
    model: "qoder/auto",
    body: { messages: [{ role: "user", content }] },
    modelConfig,
    credentials,
  });
}

describe("qoder vision gate (model_config.source)", () => {
  it("injects source when the request carries an image", async () => {
    const built = await build([
      { type: "text", text: "what colour?" },
      { type: "image_url", image_url: { url: "https://oss.example/a.png" } },
    ]);
    expect(built.payload.model_config.source).toBe("system");
    expect(built.payload.model_config.key).toBe("kmodel_latest");
    expect(built.payload.model_config.is_vl).toBe(true);
  });

  it("drops source for text-only requests", async () => {
    const built = await build([{ type: "text", text: "hello" }]);
    expect(built.payload.model_config).not.toHaveProperty("source");
    expect(built.payload.model_config.key).toBe("kmodel_latest");
  });

  it("injects source for claude-style image blocks too", async () => {
    const built = await build([
      { type: "text", text: "what colour?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
    expect(built.payload.model_config.source).toBe("system");
  });

  it("qoderChatModelConfig keeps an existing source only when asked", () => {
    const withSource = { ...modelConfig, source: "system" };
    expect(qoderChatModelConfig(withSource, { keepSource: true })).toHaveProperty("source", "system");
    expect(qoderChatModelConfig(withSource)).not.toHaveProperty("source");
  });
});

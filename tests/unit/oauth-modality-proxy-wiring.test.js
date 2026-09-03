import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const videoHandler = source("../../src/sse/handlers/videoGeneration.js");
const embeddingsHandler = source("../../src/sse/handlers/embeddings.js");
const imageHandler = source("../../src/sse/handlers/imageGeneration.js");
const embeddingsCore = source("../../open-sse/handlers/embeddingsCore.js");
const imageCore = source("../../open-sse/handlers/imageGenerationCore.js");

describe("saved proxy context wiring for non-chat modalities", () => {
  it.each([
    ["video", videoHandler],
    ["embeddings", embeddingsHandler],
    ["image", imageHandler],
  ])("passes one resolved proxy context through %s proactive refresh and core fetch", (_name, handler) => {
    expect(handler).toContain("resolveRefreshProxyOptions(credentials)");
    expect(handler).toContain("checkAndRefreshToken(provider, credentials, proxyOptions)");
    expect(handler).toMatch(/handle(?:VideoProxy|Embeddings|ImageGeneration)Core\(\{[\s\S]*?proxyOptions,/);
  });

  it("passes proxy context into embeddings reactive refresh and retry", () => {
    expect(embeddingsCore).toContain("executor.refreshCredentials(credentials, log, proxyOptions)");
    expect(embeddingsCore.match(/proxyOptions,/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("passes proxy context into image reactive refresh, adapters, polling, and downloads", () => {
    expect(imageCore).toContain("executor.refreshCredentials(credentials, log, proxyOptions)");
    expect(imageCore).toContain("adapter.executeViaExecutor(model, body, credentials, log, proxyOptions)");
    expect(imageCore).toContain("adapter.buildBody(model, body, proxyOptions)");
    expect(imageCore).toContain("urlToBase64(first.url, proxyOptions)");
    expect(imageCore).toContain("proxyOptions,");
  });
});

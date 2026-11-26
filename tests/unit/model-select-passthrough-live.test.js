// CommandCode is a `passthroughModels` provider whose live catalog contains
// deepseek/deepseek-v4.1-flash (and its fast/ultrafast variants). The static
// registry only lags behind with deepseek/deepseek-v4-flash, so the Combo
// picker showed no V4.1 row while the provider page listed it.
//
// buildModelGroups (shared by the CLI-tool cards) already preferred live rows in
// the passthrough branch. ModelSelectModal keeps a hand-synced copy of that
// logic — this guards its copy so the Combo picker cannot drift again.
//
// ModelSelectModal.js is JSX, so the branch is read as source like the other
// picker-source guards (see kenari-deepseek-vision-zed-modal.test.js).
import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";

const fileUrl = new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url);

describe("ModelSelectModal passthrough branch prefers the live catalog", () => {
  let branch;

  beforeAll(() => {
    const src = fs.readFileSync(fileUrl, "utf-8");
    const start = src.indexOf("if (providerInfo.passthroughModels) {");
    const end = src.indexOf("} else if (isCustomProvider) {");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    branch = src.slice(start, end);
  });

  it("reads liveModelsByProvider for passthrough providers", () => {
    expect(branch).toContain("liveModelsByProvider[providerId]");
  });

  it("falls back to the static registry only when the live list is empty", () => {
    expect(branch).toContain(
      "liveProviderModels.length > 0 ? liveProviderModels : getModelsByProviderId(providerId)"
    );
  });

  it("keeps live capability fields for the selector badges", () => {
    expect(branch).toContain("caps: liveModelCaps(m)");
  });
});

import { describe, expect, it } from "vitest";

import { capabilitiesFromServiceKind } from "../../open-sse/providers/capabilities.js";

describe("capabilitiesFromServiceKind", () => {
  it("maps imageToText custom models to vision-capable runtime models", () => {
    expect(capabilitiesFromServiceKind("imageToText")).toMatchObject({ vision: true });
  });

  it("maps media output/input custom model kinds to runtime capabilities", () => {
    expect(capabilitiesFromServiceKind("image")).toMatchObject({ imageOutput: true });
    expect(capabilitiesFromServiceKind("stt")).toMatchObject({ audioInput: true });
    expect(capabilitiesFromServiceKind("tts")).toMatchObject({ audioOutput: true });
  });
});

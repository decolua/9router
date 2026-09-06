/**
 * Regression: Claude Code appends `[1m]` to the model name when the
 * 1M-context beta is on, so `/v1/messages` arrives with
 * `model: "claude-opus-5[1m]"`. Nothing in 9router knows about the marker:
 * it matches no combo, no alias and no `provider/model` pair, so the request
 * is rejected at model resolution and the client reports
 *
 *   There's an issue with the selected model (claude-opus-5[1m]).
 *   It may not exist or you may not have access to it.
 *
 * The capability itself rides in the `anthropic-beta` header, which is
 * forwarded untouched, so stripping the marker is all that is needed.
 */

import { describe, it, expect } from "vitest";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";

describe("model context marker", () => {
  it("strips the [1m] marker and reports it", () => {
    expect(stripModelContextMarker("claude-opus-5[1m]")).toEqual({
      model: "claude-opus-5",
      contextMarker: "1m",
    });
  });

  it("strips it from a provider-prefixed model too", () => {
    expect(stripModelContextMarker("cc/claude-sonnet-4.5[1m]")).toEqual({
      model: "cc/claude-sonnet-4.5",
      contextMarker: "1m",
    });
  });

  it("is case insensitive", () => {
    expect(stripModelContextMarker("claude-opus-5[1M]").model).toBe("claude-opus-5");
  });

  it("leaves a plain model untouched", () => {
    expect(stripModelContextMarker("claude-opus-5")).toEqual({
      model: "claude-opus-5",
      contextMarker: null,
    });
  });

  it("only strips a trailing marker, never one inside the name", () => {
    expect(stripModelContextMarker("weird[1m]name")).toEqual({
      model: "weird[1m]name",
      contextMarker: null,
    });
  });

  it("tolerates a non-string model", () => {
    expect(stripModelContextMarker(undefined)).toEqual({ model: undefined, contextMarker: null });
  });
});

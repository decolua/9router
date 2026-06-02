import { describe, expect, it } from "vitest";
import {
  getMediaType,
  isEventStreamContentType,
  isJsonContentType
} from "../../open-sse/utils/contentType.js";

describe("content type helpers", () => {
  it("normalizes media types with parameters", () => {
    expect(getMediaType("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(getMediaType(" text/event-stream ; charset=utf-8")).toBe("text/event-stream");
  });

  it("detects event-stream without treating it as JSON", () => {
    const response = new Response("data: {}\n\n", {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    });

    expect(response.bodyUsed).toBe(false);
    expect(isEventStreamContentType(response.headers.get("content-type"))).toBe(true);
    expect(isJsonContentType(response.headers.get("content-type"))).toBe(false);
  });

  it("accepts JSON and structured JSON media types only", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("application/problem+json")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseCodexClientVersion,
  parseCodexDesktopModelCacheVersion,
} from "@/lib/codexNative/clientVersion.js";

describe("Codex Native client version detection", () => {
  it("parses stable and prerelease versions without a hard-coded current version", () => {
    expect(parseCodexClientVersion("codex-cli 0.146.0")).toBe("0.146.0");
    expect(parseCodexClientVersion("codex 0.147.0-beta.2+ws")).toBe("0.147.0-beta.2+ws");
    expect(parseCodexClientVersion("unknown")).toBeNull();
  });

  it("reads the current client version from the Codex Desktop model cache", () => {
    expect(parseCodexDesktopModelCacheVersion(JSON.stringify({
      client_version: "0.147.0",
      models: [{ slug: "gpt-5.6-terra" }],
    }))).toBe("0.147.0");
    expect(parseCodexDesktopModelCacheVersion("not json")).toBeNull();
  });
});

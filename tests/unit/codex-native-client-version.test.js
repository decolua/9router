import { describe, expect, it } from "vitest";
import { parseCodexClientVersion } from "@/lib/codexNative/clientVersion.js";

describe("Codex Native client version detection", () => {
  it("parses stable and prerelease versions without a hard-coded current version", () => {
    expect(parseCodexClientVersion("codex-cli 0.146.0")).toBe("0.146.0");
    expect(parseCodexClientVersion("codex 0.147.0-beta.2+ws")).toBe("0.147.0-beta.2+ws");
    expect(parseCodexClientVersion("unknown")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "../../src/app/(dashboard)/dashboard/providers/[id]/page.js",
  import.meta.url,
)), "utf8");

describe("OAuth proxy pool discovery", () => {
  it("marks pools ready only after a successful pool response", () => {
    const success = source.slice(
      source.indexOf("if (proxyPoolsRes.ok)"),
      source.indexOf("// Load per-provider strategy override"),
    );
    const failure = source.slice(
      source.indexOf("} catch (error) {", source.indexOf("const fetchConnections")),
      source.indexOf("} finally {", source.indexOf("const fetchConnections")),
    );

    expect(success).toContain("setProxyPoolsReady(true)");
    expect(failure).not.toContain("setProxyPoolsReady(true)");
  });
});

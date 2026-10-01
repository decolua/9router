import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath) =>
  readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("Codex settings refresh", () => {
  it("bypasses cached status after applying a selected endpoint", async () => {
    const [routeSource, cardSource] = await Promise.all([
      readSource("../../src/app/api/cli-tools/codex-settings/route.js"),
      readSource("../../src/app/(dashboard)/dashboard/cli-tools/components/CodexToolCard.js"),
    ]);

    // Route Handlers already run on the server; a Server Action directive would reject this export.
    expect(routeSource).not.toContain('"use server";');
    expect(routeSource).toContain('export const dynamic = "force-dynamic";');
    expect(cardSource).toContain('fetch("/api/cli-tools/codex-settings", { cache: "no-store" })');
    expect(cardSource).toContain("setSelectedApiKey(apiKey);");
    expect(cardSource).toContain("setCustomBaseUrl(baseUrl);");
  });

  it("keeps an unmatched active URL in the custom endpoint slot", async () => {
    const selectorSource = await readSource("../../src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js");

    expect(selectorSource).toContain("if (current) {");
    expect(selectorSource).toContain("setCustomInput(current);");
    expect(selectorSource).toContain("onChange(current);");
  });
});

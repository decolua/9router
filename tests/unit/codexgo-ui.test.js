import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const providerDetailDir = resolve(
  process.cwd(),
  "../src/app/(dashboard)/dashboard/providers/[id]"
);

describe("CodexGo dashboard UI wiring", () => {
  it("labels CodexGo-backed Codex connections distinctly", async () => {
    const {
      canRefreshCodexGoConnection,
      getConnectionAuthDisplay,
    } = await import("../../src/shared/utils/connectionAuthDisplay.js");

    const codexGoConnection = {
      provider: "codex",
      authType: "oauth",
      providerSpecificData: { authMethod: "codexgo" },
    };

    expect(getConnectionAuthDisplay(codexGoConnection, true)).toMatchObject({
      authIcon: "sync",
      authLabel: "CodexGo",
      isOAuthConnection: true,
      isCookieConnection: false,
    });
    expect(canRefreshCodexGoConnection(codexGoConnection)).toBe(true);
    expect(canRefreshCodexGoConnection({
      provider: "codex",
      authType: "oauth",
      providerSpecificData: {},
    })).toBe(false);
  });

  it("keeps normal OAuth connection display unchanged", async () => {
    const { getConnectionAuthDisplay } = await import("../../src/shared/utils/connectionAuthDisplay.js");

    expect(getConnectionAuthDisplay({ authType: "oauth" }, true)).toMatchObject({
      authIcon: "lock",
      authLabel: "OAuth",
      isOAuthConnection: true,
    });
    expect(getConnectionAuthDisplay({ authType: "cookie" }, false)).toMatchObject({
      authIcon: "cookie",
      authLabel: "Cookie",
      isCookieConnection: true,
    });
  });

  it("adds a dedicated CodexGo import modal and keeps bulk import JSON-only", () => {
    const modalSource = readFileSync(resolve(providerDetailDir, "AddCodexGoModal.js"), "utf8");
    const bulkSource = readFileSync(resolve(providerDetailDir, "BulkImportCodexModal.js"), "utf8");
    const pageSource = readFileSync(resolve(providerDetailDir, "page.js"), "utf8");

    expect(modalSource).toContain("/api/oauth/codex/import-codexgo");
    expect(modalSource).toContain('type="password"');
    expect(modalSource).toContain("Add CodexGo");
    expect(pageSource).toContain("showAddCodexGo");
    expect(pageSource).toContain("AddCodexGoModal");
    expect(pageSource).toContain("Add CodexGo");
    expect(bulkSource).not.toContain('mode === "codexgo"');
    expect(bulkSource).not.toContain("/api/oauth/codex/import-codexgo");
  });

  it("wires the CodexGo manual refresh action into connection rows", () => {
    const rowSource = readFileSync(resolve(providerDetailDir, "ConnectionRow.js"), "utf8");
    const pageSource = readFileSync(resolve(providerDetailDir, "page.js"), "utf8");

    expect(rowSource).toContain("onCodexGoRefresh");
    expect(rowSource).toContain("canRefreshCodexGoConnection");
    expect(pageSource).toContain("handleCodexGoRefresh");
    expect(pageSource).toContain("/api/oauth/codex/codexgo-refresh");
  });

  it("shows CodexGo refresh quota status in connection rows", () => {
    const rowSource = readFileSync(resolve(providerDetailDir, "ConnectionRow.js"), "utf8");

    expect(rowSource).toContain("getCodexGoRefreshMeta");
    expect(rowSource).toContain("Refresh {");
    expect(rowSource).toContain("next slot in");
    expect(rowSource).toContain("Last refresh:");
    expect(rowSource).toContain("Never refreshed");
    expect(rowSource).toContain("codexGoSyncDisabled");
    expect(rowSource).toContain("Over hourly target; refresh still allowed");
    expect(rowSource).toContain("disabled={codexGoRefreshing}");
    expect(rowSource).not.toContain("codexGoRefreshing || codexGoRefreshExhausted");
  });

  it("adds CodexGo refresh config controls to edit connection modal", () => {
    const modalSource = readFileSync(resolve(process.cwd(), "../src/shared/components/EditConnectionModal.js"), "utf8");

    expect(modalSource).toContain("codexGoRefreshConfig");
    expect(modalSource).toContain("Refresh/hour");
    expect(modalSource).toContain("Auto refresh");
    expect(modalSource).toContain("Auto threshold %");
    expect(modalSource).toContain("Quota snapshot");
    expect(modalSource).toContain("session");
    expect(modalSource).toContain("weekly");
  });
});

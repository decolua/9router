import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {} }), usePathname: () => "/dashboard/quota" }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy() {} }) }));
import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";
import { ResetCreditControls, formatCreditDate, formatTimeRemaining } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/ResetCredits.js";
import GlmResetCredits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/resetProviders/glm.js";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/resetProviders/glm.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/ResetCredits.js", import.meta.url), "utf8");
const connection = { id: "c1", provider: "glm", authType: "apikey", name: "Account" };
const props = { connection, quota: { raw: { resetCards: { availableCount: 2, cards: [] } } }, onBusy() {}, onError() {}, onRefresh: async () => true };

describe("GLM uses the shared reset controls", () => {
  it("renders the parent and existing provider controls", () => {
    expect(renderToString(<ProviderLimits />)).toBeTruthy();
    const glm = renderToString(<GlmResetCredits {...props} />);
    expect(glm).toContain('aria-label="Use one GLM reset card. 2 available."');
    expect(glm).toContain('aria-label="View GLM reset card expiry"');
    for (const provider of ["codex", "claude"]) {
      const html = renderToString(<ResetCreditControls {...props} connection={{ ...connection, provider }} quota={{ raw: { resetCredits: { availableCount: 1 } } }} />);
      expect(html).toContain("restart_alt"); expect(html).toContain("schedule");
    }
    expect(shared.match(/<ConfirmModal/g)).toHaveLength(1);
  });
  it("uses shared formatting and a fail-closed unknown inventory", () => {
    const html = renderToString(<GlmResetCredits {...props} quota={{}} />);
    expect(html).toContain("–");
    expect(formatCreditDate("invalid")).toBe("N/A");
    expect(formatTimeRemaining("2000-01-01T00:00:00Z")).toBe("Expired");
    expect(shared).toContain("onBusy(true)"); expect(shared).toContain("onBusy(false)");
  });
  it("requires selection and journals before the sole consuming request", () => {
    const prepare = source.slice(source.indexOf("const prepare"), source.indexOf("const redeem"));
    expect(prepare).not.toContain('method: "POST"');
    expect(prepare).toContain("cards.length === 1 ? cards[0] : null");
    const redeem = source.slice(source.indexOf("const redeem"), source.indexOf("const resolve"));
    expect(redeem.indexOf("savePendingResetAttempt(")).toBeLessThan(redeem.indexOf("await fetch("));
    expect(redeem.match(/method: "POST"/g)).toHaveLength(1);
    expect(redeem).toContain("recordId: card.recordId, type: card.type");
    expect(shared).toContain("reset?.invalid?.(selection)");
  });
  it("requires fresh dashboard verification and refreshes without redemption", () => {
    expect(source).toContain("!checked || JSON.stringify(pendingFor(connection.id)) !== JSON.stringify(pending)");
    expect(source).toContain("if (!clearPendingResetAttempt(");
    expect(source).toContain('window.addEventListener("storage", update)');
    const finish = source.slice(source.indexOf("const finish"), source.indexOf("const clear"));
    expect(finish.indexOf("await onRefresh()")).toBeLessThan(finish.indexOf("await load()"));
    expect(finish).not.toContain('method: "POST"');
    expect(source).toContain("Refresh to finish");
  });
});

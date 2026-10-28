import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {} }), usePathname: () => "/dashboard/quota" }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy() {} }) }));
import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";
import { ConfirmModal } from "@/shared/components/Modal";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js", import.meta.url), "utf8");

describe("GLM reuses existing reset UI", () => {
  it("renders the existing parent and one confirmation with selectable content", () => {
    expect(renderToString(<ProviderLimits />)).toBeTruthy();
    const html = renderToString(<ConfirmModal isOpen disabled title="Reset GLM limits?" message="Cannot be undone." onClose={() => {}} onConfirm={() => {}}><label>Quota window<select><option>Weekly</option></select></label></ConfirmModal>);
    expect(html).toContain("Quota window");
    expect(html).toContain("Weekly");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(source.match(/<ConfirmModal/g)).toHaveLength(1);
    expect(source).not.toContain("<GlmResetCards");
  });
  it("uses shared row controls, formatting, busy/error state and details framing", () => {
    expect(source).toContain("(isCodex || claudeReset || isGlm)");
    expect(source).toContain("prepareGlmReset(conn)");
    expect(source).toContain("(isCodex || isGlm) ? handleViewCodexResetCredits");
    expect(source).toContain("setResettingLimitId(connection.id)");
    expect(source).toContain("formatCreditDate(card.expiresAt)");
    expect(source).toContain("formatTimeRemaining(card.expiresAt)");
  });
  it("prepares read-only, requires type selection, journals before its sole POST, and checks expiry again", () => {
    const prepare = source.slice(source.indexOf("const prepareGlmReset"), source.indexOf("const handleGlmReset"));
    expect(prepare).not.toContain('method: "POST"');
    expect(prepare).toContain("cards.length === 1 ? cards[0] : null");
    const reset = source.slice(source.indexOf("const handleGlmReset"), source.indexOf("const handleResetCodexLimit"));
    expect(reset.indexOf("savePendingResetAttempt(")).toBeLessThan(reset.indexOf("await fetch("));
    expect(reset.match(/method: "POST"/g)).toHaveLength(1);
    expect(reset).toContain("isResetCardExpired(card.expiresAt)");
    expect(reset).toContain("recordId: card.recordId, type: card.type");
    expect(source).toContain("isResetCardExpired(resetConfirmState.card.expiresAt, glmResetNow)");
  });
  it("requires fresh dashboard acknowledgment and retries refresh without another mutation", () => {
    expect(source).toContain("!resetCreditsState?.dashboardChecked");
    expect(source).toContain("JSON.stringify(latest) !== JSON.stringify(resetCreditsState.pending)");
    expect(source).toContain("if (!clearPendingResetAttempt(");
    const quota = source.indexOf("if (!await fetchQuota(connection.id");
    expect(source.indexOf("const inventory = await readGlmResets(connection)", quota)).toBeGreaterThan(quota);
    expect(source).toContain("Refresh to finish");
    expect(source).toContain('window.addEventListener("storage", onStorage)');
  });
});

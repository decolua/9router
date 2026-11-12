import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {} }), usePathname: () => "/dashboard/quota" }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy() {} }) }));
import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";
import MiniMaxResetCredits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/resetProviders/minimax-code-global.js";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/resetProviders/minimax-code-global.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/ResetCredits.js", import.meta.url), "utf8");
const props = { connection: { id: "c1", provider: "minimax-code-global", authType: "oauth" }, quota: { raw: { resetCards: { availableCount: 2 } } }, onBusy() {}, onError() {}, onRefresh: async () => true };

describe("MiniMax uses the shared reset controls", () => {
  it("renders the existing parent and OAuth-only reset controls", () => {
    expect(renderToString(<ProviderLimits />)).toBeTruthy();
    const html = renderToString(<MiniMaxResetCredits {...props} />);
    expect(html).toContain('aria-label="Use one MiniMax reset card. 2 available."');
    expect(html).toContain('aria-label="View MiniMax reset card expiry"');
    for (const authType of ["apikey", "mcode-lease"]) expect(renderToString(<MiniMaxResetCredits {...props} connection={{ ...props.connection, authType }} />)).toBe("");
  });
  it("shares the existing confirmation, busy state, and expiry table", () => {
    expect(shared.match(/<ConfirmModal/g)).toHaveLength(1);
    expect(shared).toContain("inFlight.current");
    expect(shared).toContain("onBusy(true)");
    expect(shared).toContain("formatTimeRemaining(card.expiresAt)");
    expect(source).toContain("<ResetCreditControls");
  });
  it("prepares and inspects with reads only, requiring confirmation before POST", () => {
    const prepare = source.slice(source.indexOf("const prepare"), source.indexOf("const redeem"));
    expect(prepare).not.toContain('method: "POST"');
    const load = source.slice(source.indexOf("const load"), source.indexOf("const post"));
    expect(load).not.toContain('method: "POST"');
    expect(shared).toContain("setConfirmation(null)");
  });
  it("pins same-card retries and acknowledges only after quota and inventory refresh", () => {
    expect(source).toContain("attemptId: selection.pending.attemptId");
    expect(source).toContain("current.pending?.attemptId !== selection.pending?.attemptId");
    expect(source).toContain("current.pending.attemptId !== expectedAttempt");
    expect(source).toContain("current.pending.card.cardId !== card.cardId");
    const finish = source.slice(source.indexOf("const finish"), source.indexOf("const prepare"));
    expect(finish.indexOf("await onRefresh()")).toBeLessThan(finish.indexOf("await load()"));
    expect(finish.indexOf("await load()")).toBeLessThan(finish.indexOf("acknowledge: true"));
    expect(source).toContain("!(result.uncertain && result.pending === null)");
  });
});

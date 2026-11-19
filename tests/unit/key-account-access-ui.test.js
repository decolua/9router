import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controls = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/KeyAccessControls.js", import.meta.url), "utf8");
const endpoint = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url), "utf8");

describe("API key account access UI contract", () => {
  it("keeps account restrictions independent from model restrictions", () => {
    expect(controls).toContain('label="Restrict accounts"');
    expect(controls).toContain("checked={access.accountsRestricted}");
    expect(controls).toContain("onChange({ ...access, accountsRestricted })");
    expect(controls).toContain("onChange({ ...access, restricted: false })");
    expect(controls).toContain("onChange({ ...access, restricted: true, allow })");
    expect(endpoint).toContain("{ ...key.access, restricted: true, allow: key.access?.allow || [] }");
  });

  it("loads provider connections and stores only account display fields", () => {
    expect(controls).toContain('fetch("/api/providers", { signal: controller.signal })');
    expect(controls).toContain("map(({ id, provider, name, email }) => ({ id, provider, name, email }))");
    expect(controls).toContain('type="checkbox"');
    expect(controls).toContain("checked={access.accountIds.includes(account.id)}");
    expect(controls).toContain("[...access.accountIds, account.id]");
    expect(controls).toContain("access.accountIds.filter((id) => id !== account.id)");
  });

  it("supports failed loads and unavailable selected accounts without clearing policy", () => {
    expect(controls).toContain('role="alert"');
    expect(controls).toContain("setAccountsRetry((value) => value + 1)");
    expect(controls).toContain("return () => controller.abort()");
    expect(controls).toContain("Unavailable account ({id})");
    expect(controls).toContain("accountIds: access.accountIds.filter((accountId) => accountId !== id)");
    expect(controls).toContain("disabled={saving} aria-busy={saving}");
    expect(controls).toContain("await onSave(nextAccess)");
    expect(controls).not.toContain("accountIds: [] })");
  });
});

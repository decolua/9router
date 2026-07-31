import { describe, it, expect } from "vitest";
import {
  extractQoderworkProfileFromUserinfo,
  mergePersistedProfileData,
} from "../../src/shared/utils/qoderworkProfile.js";
import { dayKeyInTimeZone } from "../../src/shared/utils/timezone.js";

describe("qoderworkProfile", () => {
  it("extracts display name and login source; no phone when not phone-like", () => {
    const p = extractQoderworkProfileFromUserinfo({
      id: "u1",
      name: "aliyun7850973340",
      source: "sso.aliyun",
    });
    expect(p.displayName).toBe("aliyun7850973340");
    expect(p.phoneMasked).toBe(null);
    expect(p.loginSource).toBe("sso.aliyun");
  });

  it("masks phone-like name", () => {
    const p = extractQoderworkProfileFromUserinfo({ name: "13812345678" });
    expect(p.phoneMasked).toMatch(/\*/);
    expect(p.phone).toBe("13812345678");
  });

  it("derives calendar days in the requested timezone", () => {
    const instant = new Date("2026-01-01T16:30:00.000Z");
    expect(dayKeyInTimeZone("Asia/Shanghai", instant)).toBe("2026-01-02");
    expect(dayKeyInTimeZone("UTC", instant)).toBe("2026-01-01");
  });

  it("omits newly fetched raw phone from persisted profile data", () => {
    const persisted = mergePersistedProfileData(
      { loginSource: "existing" },
      { phone: "13812345678", phoneMasked: "138****5678", userId: "u1" },
    );
    expect(persisted).toEqual({
      loginSource: "existing",
      phoneMasked: "138****5678",
      userId: "u1",
    });
  });

  it("preserves a historical raw phone without replacing it", () => {
    const persisted = mergePersistedProfileData(
      { phone: "historical" },
      { phone: "new-raw", phoneMasked: "new****mask" },
    );
    expect(persisted.phone).toBe("historical");
    expect(persisted.phoneMasked).toBe("new****mask");
  });
});

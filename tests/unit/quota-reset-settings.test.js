import { describe, it, expect } from "vitest";
import { defaultConfig, readConfig, normalizeConfig, maskConfig } from "@/shared/services/quotaResetSettings.js";

const slack = { id: "s1", name: "Slack", type: "slack", url: "https://hooks.slack.com/services/T/B/SECRET" };
const tg = { id: "t1", name: "TG", type: "telegram", botToken: "123456:ABCdef_ghijklmnop", chatId: "-1001234" };

describe("normalizeConfig", () => {
  it("accepts a full config and fills template defaults", () => {
    const c = normalizeConfig({ enabled: true, targets: [slack, tg] }, undefined);
    expect(c.enabled).toBe(true);
    expect(c.targets).toHaveLength(2);
    expect(c.titleTemplate).toBeTruthy();
    expect(c.bodyTemplate).toContain("{account}");
  });

  it("keeps the stored secret when the url / token is left blank", () => {
    const stored = normalizeConfig({ targets: [slack, tg] }, undefined);
    const edited = normalizeConfig({ targets: [{ ...slack, url: "", name: "Renamed" }, { ...tg, botToken: "" }] }, stored);
    expect(edited.targets[0].url).toBe(stored.targets[0].url);
    expect(edited.targets[0].name).toBe("Renamed");
    expect(edited.targets[1].botToken).toBe(tg.botToken);
  });

  it.each([
    ["non-http scheme", { ...slack, url: "file:///etc/passwd" }],
    ["garbage url", { ...slack, url: "not a url" }],
    ["missing url", { ...slack, url: "", id: "fresh" }],
    ["unknown type", { ...slack, type: "sms" }],
    ["bad bot token (path injection)", { ...tg, botToken: "1/../../x" }],
    ["bad chat id", { ...tg, chatId: "abc def" }],
  ])("rejects %s", (_n, target) => {
    expect(() => normalizeConfig({ targets: [target] }, undefined)).toThrow();
  });

  it("rejects too many targets and over-long templates", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...slack, id: `x${i}` }));
    expect(() => normalizeConfig({ targets: many }, undefined)).toThrow(/최대/);
    expect(() => normalizeConfig({ bodyTemplate: "a".repeat(501) }, undefined)).toThrow(/500/);
  });

  it("sanitises per-account overrides", () => {
    const c = normalizeConfig({ connections: { good: { weekly: false, junk: 1 }, "bad id!": { weekly: true }, empty: {} } }, undefined);
    expect(c.connections).toEqual({ good: { weekly: false } });
  });

  it("keeps stored connections / targets when the request omits them", () => {
    const stored = normalizeConfig({ targets: [slack], connections: { a: { weekly: false } } }, undefined);
    const next = normalizeConfig({ enabled: true }, stored);
    expect(next.targets).toHaveLength(1);
    expect(next.connections).toEqual({ a: { weekly: false } });
  });
});

describe("maskConfig", () => {
  it("never exposes the url path, query or bot token", () => {
    const stored = normalizeConfig({ targets: [slack, tg] }, undefined);
    const json = JSON.stringify(maskConfig(stored));
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("ABCdef");
    const [s, t] = maskConfig(stored).targets;
    expect(s).toMatchObject({ urlSet: true, urlHost: "hooks.slack.com" });
    expect(t).toMatchObject({ botTokenSet: true, chatId: "-1001234" });
  });
});

describe("readConfig", () => {
  it("returns defaults for missing or malformed values", () => {
    expect(readConfig(undefined)).toEqual(defaultConfig());
    expect(readConfig("x").targets).toEqual([]);
    expect(readConfig({ enabled: "yes" }).enabled).toBe(false);
  });
});

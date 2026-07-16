import { describe, it, expect } from "vitest";
import {
  buildExportJson,
  buildExportTxt,
  connectionToExportKey,
  ensureKeyNames,
  isExportableConnection,
  parseImportContent,
  parseTxtKeys,
  pickExportableProviderSpecificData,
} from "../../src/lib/providerKeysIo.js";

const sampleConns = [
  {
    id: "1",
    provider: "openrouter",
    authType: "apikey",
    name: "prod",
    apiKey: "sk-prod",
    priority: 1,
    isActive: true,
  },
  {
    id: "2",
    provider: "openrouter",
    authType: "apikey",
    name: "stage",
    apiKey: "sk-stage",
    priority: 2,
    isActive: false,
    defaultModel: "gpt-4o",
  },
  {
    id: "3",
    provider: "openrouter",
    authType: "oauth",
    name: "oauth-user",
    accessToken: "tok",
    refreshToken: "rt",
  },
  {
    id: "4",
    provider: "openrouter",
    authType: "apikey",
    name: "empty",
    apiKey: "",
  },
];

describe("providerKeysIo", () => {
  it("isExportableConnection only allows apikey/cookie with a key", () => {
    expect(isExportableConnection(sampleConns[0])).toBe(true);
    expect(isExportableConnection(sampleConns[2])).toBe(false);
    expect(isExportableConnection(sampleConns[3])).toBe(false);
    expect(isExportableConnection({ provider: "ollama-local", authType: "apikey", apiKey: "" })).toBe(true);
  });

  it("buildExportJson excludes oauth and empty keys", () => {
    const payload = buildExportJson("openrouter", sampleConns);
    expect(payload.version).toBe(1);
    expect(payload.provider).toBe("openrouter");
    expect(payload.count).toBe(2);
    expect(payload.keys).toHaveLength(2);
    expect(payload.keys[0]).toMatchObject({ name: "prod", apiKey: "sk-prod" });
    expect(payload.keys[1].defaultModel).toBe("gpt-4o");
    expect(payload.keys[1].isActive).toBe(false);
  });

  it("buildExportTxt uses name|apiKey lines", () => {
    const txt = buildExportTxt("openrouter", sampleConns);
    expect(txt).toBe("prod|sk-prod\nstage|sk-stage\n");
  });

  it("buildExportTxt includes accountId for cloudflare-ai", () => {
    const txt = buildExportTxt("cloudflare-ai", [
      {
        authType: "apikey",
        name: "cf",
        apiKey: "sk-cf",
        providerSpecificData: { accountId: "acc123" },
      },
    ]);
    expect(txt).toBe("cf|sk-cf|acc123\n");
  });

  it("parseTxtKeys handles name|key and bare key", () => {
    const keys = parseTxtKeys("a|sk-a\nsk-only\n# comment\n");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ name: "a", apiKey: "sk-a" });
    expect(keys[1]).toMatchObject({ name: "", apiKey: "sk-only" });
  });

  it("parseTxtKeys handles cloudflare accountId", () => {
    const keys = parseTxtKeys("n|sk-x|acc9", { provider: "cloudflare-ai" });
    expect(keys[0].providerSpecificData).toEqual({ accountId: "acc9" });
  });

  it("parseImportContent accepts JSON envelope and array", () => {
    const envelope = parseImportContent(
      JSON.stringify({ provider: "openrouter", keys: [{ name: "a", apiKey: "sk-a" }] }),
      "json"
    );
    expect(envelope.format).toBe("json");
    expect(envelope.providerHint).toBe("openrouter");
    expect(envelope.keys).toHaveLength(1);

    const arr = parseImportContent('[{"apiKey":"sk-1"},"sk-2"]', "json");
    expect(arr.keys).toHaveLength(2);
    expect(arr.keys[1].apiKey).toBe("sk-2");
  });

  it("parseImportContent auto-detects txt", () => {
    const parsed = parseImportContent("n|sk-n\n", "auto");
    expect(parsed.format).toBe("txt");
    expect(parsed.keys[0].apiKey).toBe("sk-n");
  });

  it("ensureKeyNames fills missing names", () => {
    const named = ensureKeyNames([{ name: "", apiKey: "sk" }, { name: "keep", apiKey: "sk2" }]);
    expect(named[0].name).toBe("Key 1");
    expect(named[1].name).toBe("keep");
  });

  it("pickExportableProviderSpecificData filters unknown fields", () => {
    expect(
      pickExportableProviderSpecificData({
        accountId: "a",
        proxyPoolId: "p",
        connectionProxyUrl: "http://x",
        region: "us",
      })
    ).toEqual({ accountId: "a", region: "us" });
  });

  it("connectionToExportKey maps fields", () => {
    const rec = connectionToExportKey({
      name: "n",
      apiKey: "k",
      authType: "cookie",
      priority: 3,
      isActive: true,
      providerSpecificData: { region: "eu", junk: 1 },
    });
    expect(rec).toEqual({
      name: "n",
      apiKey: "k",
      authType: "cookie",
      priority: 3,
      isActive: true,
      providerSpecificData: { region: "eu" },
    });
  });
});

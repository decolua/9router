import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { AI_PROVIDERS, FREE_PROVIDERS } from "@/shared/constants/providers";
import {
  isConnectableConnection,
  selectConnectableProviders,
  selectNoAuthProviderIds,
} from "@/shared/utils/modelSelectorProviders";

const connection = (over = {}) => ({ id: "conn-1", provider: "groq", isActive: true, ...over });

describe("model selector — providers without usable credentials", () => {
  it("drops connections the user disabled", () => {
    const connections = [
      connection({ id: "on", provider: "openrouter" }),
      connection({ id: "off", provider: "xiaomi-mimo", isActive: false }),
    ];

    expect(selectConnectableProviders(connections, AI_PROVIDERS).map((c) => c.id)).toEqual(["on"]);
  });

  it("hides a provider when every connection of it is disabled", () => {
    const connections = [
      connection({ id: "a", provider: "groq", isActive: false }),
      connection({ id: "b", provider: "groq", isActive: false }),
    ];

    expect(selectConnectableProviders(connections, AI_PROVIDERS)).toEqual([]);
  });

  it("keeps a disabled connection of a provider that also has an active one", () => {
    const connections = [
      connection({ id: "a", provider: "groq", isActive: false }),
      connection({ id: "b", provider: "groq", isActive: true }),
    ];

    expect(selectConnectableProviders(connections, AI_PROVIDERS).map((c) => c.id)).toEqual(["b"]);
  });

  it("keeps legacy connections that predate the isActive flag", () => {
    // Old rows carry no flag and are still routed, so they must stay selectable.
    expect(selectConnectableProviders([{ id: "legacy", provider: "groq" }], AI_PROVIDERS)).toHaveLength(1);
  });

  it("only the explicit boolean false hides a connection", () => {
    // Mirrors the server-side check `connections.filter(c => c.isActive !== false)`.
    expect(isConnectableConnection({ provider: "groq", isActive: 0 }, AI_PROVIDERS)).toBe(true);
    expect(isConnectableConnection({ provider: "groq", isActive: false }, AI_PROVIDERS)).toBe(false);
  });

  it("drops providers the registry marks as hidden", () => {
    const providers = { visible: { name: "Visible" }, secret: { name: "Secret", hidden: true } };
    const connections = [connection({ id: "v", provider: "visible" }), connection({ id: "s", provider: "secret" })];

    expect(selectConnectableProviders(connections, providers).map((c) => c.id)).toEqual(["v"]);
  });

  it("survives a failed /api/providers fetch", () => {
    expect(selectConnectableProviders(undefined, AI_PROVIDERS)).toEqual([]);
    expect(selectConnectableProviders(null, AI_PROVIDERS)).toEqual([]);
    expect(selectConnectableProviders({ connections: [] }, AI_PROVIDERS)).toEqual([]);
  });

  it("keeps credential-less free providers selectable, except hidden ones", () => {
    const ids = selectNoAuthProviderIds(FREE_PROVIDERS);

    // Registry fact the selector depends on: mimo-free needs no auth but is hidden.
    expect(FREE_PROVIDERS["mimo-free"]).toMatchObject({ noAuth: true, hidden: true });
    expect(ids).not.toContain("mimo-free");
    expect(ids).toContain("opencode");
  });

  it("is wired into the picker (no source of providers bypasses it)", () => {
    const source = readFileSync(
      new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/selectNoAuthProviderIds\(FREE_PROVIDERS\)/);
    expect(source).toMatch(/\.filter\(\(id\) => !AI_PROVIDERS\[id\]\?\.hidden\)/);
  });
});

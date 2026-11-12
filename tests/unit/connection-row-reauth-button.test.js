import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/shared/components", () => ({
  Badge: ({ children }) => createElement("span", { "data-badge": true }, children),
  Toggle: () => createElement("span", { "data-toggle": true }),
  Tooltip: ({ children }) => createElement("span", { "data-tooltip": true }, children),
}));
vi.mock("@/app/(dashboard)/dashboard/providers/[id]/CooldownTimer.js", () => ({
  default: () => null,
}));

const { default: ConnectionRow } = await import(
  "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"
);

const render = (connection, extra = {}) => renderToStaticMarkup(createElement(ConnectionRow, {
  connection: {
    id: "c1",
    name: "Account",
    displayName: "Account",
    email: "account@example.com",
    priority: 1,
    providerSpecificData: {},
    ...connection,
  },
  proxyPools: [],
  isOAuth: true,
  isFirst: false,
  isLast: false,
  onMoveUp: () => {},
  onMoveDown: () => {},
  onToggleActive: () => {},
  onUpdateProxy: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onReconnect: () => {},
  ...extra,
}));

// The row is the outermost div; the identity/status block is its first child.
const rowClass = (html) => html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
const infoClass = (html) => html.match(/^<div class="[^"]*"><div class="([^"]*)"/)?.[1] ?? "";
const reconnectButton = (html) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Reconnect(?:(?!<\/button>).)*<\/button>/s)?.[0] ?? null;

describe("re-auth affordance on a disabled row", () => {
  it("dims the identity block, not the row that carries the repair button", () => {
    const html = render({ authType: "oauth", isActive: false, testStatus: "reauth_required" });
    expect(rowClass(html)).not.toContain("opacity-60");
    expect(infoClass(html)).toContain("opacity-60");
  });

  it("leaves an active row undimmed", () => {
    const html = render({ authType: "oauth", isActive: true, testStatus: "active" });
    expect(rowClass(html)).not.toContain("opacity-60");
    expect(infoClass(html)).not.toContain("opacity-60");
  });

  it("keeps Reconnect lit on a quarantined OAuth row", () => {
    const html = render({ authType: "oauth", isActive: false, testStatus: "reauth_required" });
    const button = reconnectButton(html);
    expect(button).not.toBeNull();
    expect(button).toContain("text-amber-600");
    expect(button).toContain("bg-amber-500/10");
    // The button must sit in the actions block, a sibling of the dimmed block:
    // opacity composites, so a child of an opacity-60 parent can never render
    // at full brightness.
    const actionsIdx = html.indexOf('<div class="flex w-full items-center justify-between');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(html.indexOf(button)).toBeGreaterThan(actionsIdx);
  });

  it("offers Reconnect on an access_token row, which is quarantined the same way", () => {
    const html = render({ authType: "access_token", isActive: false, testStatus: "reauth_required" });
    expect(reconnectButton(html)).not.toBeNull();
  });

  it("offers Reconnect on a row disabled by hand even without a reauth flag", () => {
    const html = render({ authType: "oauth", isActive: false, testStatus: "active" });
    expect(reconnectButton(html)).not.toBeNull();
  });

  it("does not offer Reconnect on a healthy active row", () => {
    const html = render({ authType: "oauth", isActive: true, testStatus: "active" });
    expect(reconnectButton(html)).toBeNull();
  });

  it("does not offer Reconnect when the provider has no OAuth login", () => {
    const html = render({ authType: "oauth", isActive: false, testStatus: "reauth_required" }, { onReconnect: null });
    expect(reconnectButton(html)).toBeNull();
  });

  it("does not offer Reconnect on an API-key row of a dual-mode provider", () => {
    const html = render({ authType: "apikey", isActive: false, testStatus: "reauth_required" });
    expect(reconnectButton(html)).toBeNull();
    expect(html).toContain("Update key");
  });

  it("keeps Update key lit on a quarantined API-key row", () => {
    const html = render({ authType: "apikey", isActive: false, testStatus: "reauth_required" });
    expect(rowClass(html)).not.toContain("opacity-60");
    const button = html.match(/<button[^>]*>(?:(?!<\/button>).)*Update key(?:(?!<\/button>).)*<\/button>/s)?.[0];
    expect(button).toContain("text-amber-600");
  });

  it("does not claim a key needs replacing just because the row is disabled", () => {
    const html = render({ authType: "apikey", isActive: false, testStatus: "active" });
    expect(html).not.toContain("Update key");
    expect(html).toContain(">Edit<");
  });

  it("still labels a quarantined row Re-auth required rather than disabled", () => {
    const html = render({ authType: "oauth", isActive: false, testStatus: "reauth_required" });
    expect(html).toContain("Re-auth required");
  });
});
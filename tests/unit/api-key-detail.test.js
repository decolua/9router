import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import KeyDetail from "@/app/(dashboard)/dashboard/endpoint/components/KeyDetail";

const apiKey = {
  id: "key-1", name: "Production", key: "sk-7d6hidden57be", createdAt: "2026-01-01",
  expiresAt: "2026-03-13T00:00:00Z", owner: "Team", project: "Tools", isActive: true,
};
const now = Date.parse("2026-03-01T00:00:00Z");
const windows = {
  minute: { used: 2, limit: 5 }, hour: { used: 7, limit: 10 },
  day: { used: 9, limit: 10 }, month: { used: 30, limit: null },
};
const usage = [
  { id: "other", name: apiKey.name, requests: 9999, tokens: 9999, cost: 9999, errorRate: 1 },
  { id: apiKey.id, name: "Former name", requests: 21, tokens: 134, cost: 0.3, errorRate: 0.125 },
];
function render(extra = {}) {
  return renderToStaticMarkup(createElement(KeyDetail, {
    apiKey, now, windows, usage, connections: [], visibleKeys: new Set(), ...extra,
  }));
}

it("matches seven-day usage by key ID and hides it for non-admins", () => {
  const admin = render({ isAdmin: true });
  expect(admin).toContain("Usage (last 7 days)");
  expect(admin).toContain(">134</dd>");
  expect(admin).toContain(">12.5%</dd>");
  expect(render({ isAdmin: true, usage: [] })).toContain("No usage in this period");
  expect(render({ isAdmin: false })).not.toContain("Usage (last 7 days)");
});

it("shows real quota meters and an inline expiry summary without disclosing the secret", () => {
  const html = render();
  expect(html.match(/role="meter"/g)).toHaveLength(3);
  for (const color of ["bg-success", "bg-warning", "bg-danger"]) expect(html).toContain(color);
  expect(html).toContain("Unlimited");
  expect(html).toContain("12 days left");
  expect(html).not.toContain("<details");
  expect(html).toContain("sk-7d6…57be");
  expect(html).not.toContain(apiKey.key);
  expect(render({ visibleKeys: new Set([apiKey.id]) })).toContain(apiKey.key);
});

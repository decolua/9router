import { expect, it } from "vitest";
import { filterKeys, maskKey } from "@/shared/utils/apiKeyList";

const now = Date.parse("2026-03-01T12:00:00Z");
const keys = [
  { id: "1", name: "Build", project: "Studio", owner: "Elif", description: "Benchmarks", access: { restricted: true } },
  { id: "2", name: "Beta", project: "Studio", owner: "Ada", isActive: false },
  { id: "3", name: "Legacy", project: "Lab", expiresAt: new Date(now).toISOString(), allowedConnections: ["c"] },
];
const ids = filters => filterKeys(keys, filters, now).map(key => key.id);

it.each([" build ", "ELIF", "studio", "mark"])("searches all four metadata fields: %s", search => {
  expect(ids({ search })).toContain("1");
});
it("combines status and project filters with the search", () => {
  expect(ids({ status: "Active" })).toEqual(["1"]);
  expect(ids({ status: "Expired" })).toEqual(["3"]);
  expect(ids({ status: "Restricted" })).toEqual(["1", "3"]);
  expect(ids({ search: "ada", status: "Paused", project: "Studio" })).toEqual(["2"]);
  expect(ids({ search: "ada", project: "Lab" })).toEqual([]);
});
it("never returns a short secret verbatim", () => {
  expect(maskKey("short")).not.toContain("short");
  expect(maskKey("sk-7d6private57be")).toBe("sk-7d6…57be");
});

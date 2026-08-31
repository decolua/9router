// Pure-math pagination logic for the provider detail connections list.
// Imports from the shared utility so the page and tests share one source of truth.
// Also includes a structural guard: if someone removes pagination from
// src/app/(dashboard)/dashboard/providers/[id]/page.js, the structural test fails.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { CONNECTIONS_PER_PAGE, CONNECTIONS_MAX_PAGE_SIZE, computeConnectionPagination } from "../../src/app/(dashboard)/dashboard/providers/[id]/connectionsPagination.js";

const PAGE_PATH = path.resolve(
  "src/app/(dashboard)/dashboard/providers/[id]/page.js",
);

describe("provider connections pagination — utility math (10/page)", () => {
  it("exposes the page size constant", () => {
    expect(CONNECTIONS_PER_PAGE).toBe(10);
  });

  it("returns empty items when connections list is empty", () => {
    const r = computeConnectionPagination([], 1);
    expect(r).toMatchObject({
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      start: 0,
      items: [],
      pageSize: 10,
    });
  });

  it("treats null/undefined/non-array connections as an empty list", () => {
    expect(computeConnectionPagination(null, 1).items).toEqual([]);
    expect(computeConnectionPagination(undefined, 1).items).toEqual([]);
    expect(computeConnectionPagination("nope", 1).items).toEqual([]);
  });

  it("keeps a single page when count <= 10", () => {
    const conns = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` }));
    const r = computeConnectionPagination(conns, 1);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
    expect(r.items).toHaveLength(7);
    expect(r.items[0]).toEqual({ id: "c0" });
    expect(r.items[6]).toEqual({ id: "c6" });
  });

  it("returns exactly 10 items when count == 10 (boundary)", () => {
    const conns = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));
    const r = computeConnectionPagination(conns, 1);
    expect(r.totalPages).toBe(1);
    expect(r.items).toHaveLength(10);
  });

  it("creates exactly 2 pages when count == 11", () => {
    const conns = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}` }));
    const r1 = computeConnectionPagination(conns, 1);
    const r2 = computeConnectionPagination(conns, 2);
    expect(r1.totalPages).toBe(2);
    expect(r1.items).toHaveLength(10);
    expect(r1.items[0].id).toBe("c0");
    expect(r1.items[9].id).toBe("c9");
    expect(r2.items).toHaveLength(1);
    expect(r2.items[0].id).toBe("c10");
  });

  it("slices correctly across multiple pages (25 connections → 3 pages)", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    const p1 = computeConnectionPagination(conns, 1);
    const p2 = computeConnectionPagination(conns, 2);
    const p3 = computeConnectionPagination(conns, 3);
    expect(p1.totalPages).toBe(3);
    expect(p1.items.map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`));
    expect(p2.items.map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `c${10 + i}`));
    expect(p3.items.map((c) => c.id)).toEqual(["c20", "c21", "c22", "c23", "c24"]);
  });

  it("clamps the requested page to totalPages when too high", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    const r = computeConnectionPagination(conns, 99);
    expect(r.currentPage).toBe(3);
    expect(r.items[0].id).toBe("c20");
  });

  it("clamps the requested page to 1 when too low / non-positive", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    expect(computeConnectionPagination(conns, 0).currentPage).toBe(1);
    expect(computeConnectionPagination(conns, -5).currentPage).toBe(1);
  });

  it("treats non-integer / NaN page as 1", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    expect(computeConnectionPagination(conns, NaN).currentPage).toBe(1);
    expect(computeConnectionPagination(conns, 1.7).currentPage).toBe(1);
    expect(computeConnectionPagination(conns, "2").currentPage).toBe(2);
  });

  it("collapses totalPages to 1 when connections is empty even if page was high", () => {
    const r = computeConnectionPagination([], 5);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
    expect(r.items).toEqual([]);
  });

  it("exposes a stable start index per page (used for isFirst/isLast flags)", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    expect(computeConnectionPagination(conns, 1).start).toBe(0);
    expect(computeConnectionPagination(conns, 2).start).toBe(10);
    expect(computeConnectionPagination(conns, 3).start).toBe(20);
  });

  it("returns the exact same connection objects (no clone)", () => {
    const a = { id: "a", name: "A" };
    const b = { id: "b", name: "B" };
    const r = computeConnectionPagination([a, b], 1);
    expect(r.items[0]).toBe(a);
    expect(r.items[1]).toBe(b);
  });

  it("does not mutate the input array", () => {
    const conns = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}` }));
    const snapshot = conns.slice();
    computeConnectionPagination(conns, 2);
    expect(conns).toEqual(snapshot);
    expect(conns).toHaveLength(30);
  });

  it("handles very large lists (1000 connections → 100 pages)", () => {
    const conns = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}` }));
    const r = computeConnectionPagination(conns, 100);
    expect(r.totalPages).toBe(100);
    expect(r.currentPage).toBe(100);
    expect(r.items).toHaveLength(10);
    expect(r.items[0].id).toBe("c990");
  });

  it("honors an explicit pageSize (25 items at 20/page → 2 pages)", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    const r = computeConnectionPagination(conns, 1, 20);
    expect(r.totalPages).toBe(2);
    expect(r.pageSize).toBe(20);
    expect(r.items).toHaveLength(20);
    expect(r.items.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `c${i}`));
  });

  it("exposes a max page-size constant", () => {
    expect(CONNECTIONS_MAX_PAGE_SIZE).toBe(200);
  });

  it("falls back to CONNECTIONS_PER_PAGE for invalid/zero/fractional pageSize", () => {
    const conns = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
    expect(computeConnectionPagination(conns, 1, 0).pageSize).toBe(10);
    expect(computeConnectionPagination(conns, 1, NaN).pageSize).toBe(10);
    expect(computeConnectionPagination(conns, 1, 0.5).pageSize).toBe(10);
    expect(computeConnectionPagination(conns, 1, 0.5).totalPages).toBe(3);
  });
});

describe("provider connections pagination — page.js structural guard", () => {
  let source;

  beforeAll(() => {
    if (!fs.existsSync(PAGE_PATH)) {
      throw new Error(`expected page.js at ${PAGE_PATH}`);
    }
    source = fs.readFileSync(PAGE_PATH, "utf8");
  });

  it("imports the Pagination component from @/shared/components", () => {
    expect(source).toMatch(/import\s+\{[^}]*\bPagination\b[^}]*\}\s+from\s+["']@\/shared\/components["']/);
  });

  it("imports the shared pagination utility (single source of truth)", () => {
    expect(source).toMatch(/from\s+["']\.\/connectionsPagination["']/);
  });

  it("declares a connectionPage state", () => {
    expect(source).toMatch(/const\s+\[\s*connectionPage\s*,\s*setConnectionPage\s*\]\s*=\s*useState\(\s*1\s*\)/);
  });

  it("computes paged connections via the utility", () => {
    expect(source).toMatch(/computeConnectionPagination\(/);
  });

  it("renders the paginated list (not the raw connections array)", () => {
    expect(source).toMatch(/pagedConnections\.map\(/);
    expect(source).not.toMatch(/^\s*\{\s*connections\s*\n\s*\.map\(\(/m);
  });

  it("renders the Pagination component when there are multiple pages", () => {
    expect(source).toMatch(/<Pagination\b/);
    expect(source).toMatch(/connections\.length\s*>\s*CONNECTIONS_PER_PAGE/);
  });

  it("uses CONNECTIONS_PER_PAGE constant from the utility (not a magic number)", () => {
    const directMatches = source.match(/pageSize\s*=\s*\{?\s*10\s*\}?/g) || [];
    expect(directMatches).toHaveLength(0);
    expect(source).toMatch(/pageSize=\{pageSize\}/);
    expect(source).toMatch(/useState\(CONNECTIONS_PER_PAGE\)/);
  });

  it("wires a configurable page size into pagination", () => {
    expect(source).toMatch(/setPageSize/);
    expect(source).toMatch(/computeConnectionPagination\(connections, connectionPage, pageSize\)/);
    expect(source).toMatch(/onPageSizeChange/);
  });

  it("select-all is page-scoped (uses paged connections, not the full array)", () => {
    expect(source).toMatch(/pagedConnectionIds/);
    expect(source).not.toMatch(/setSelectedConnectionIds\(connections\.map/);
  });
});

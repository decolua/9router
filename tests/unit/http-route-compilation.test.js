import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const apiRoot = fileURLToPath(new URL("../../src/app/api/", import.meta.url));
function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.js" ? [path] : [];
  });
}

describe("HTTP route compilation", () => {
  it("does not register HTTP method exports as React Server Functions", () => {
    // Route handlers are already server-side. A module-level use-server directive
    // registers GET/POST as actions and crashes Next's action manifest generation.
    const routes = routeFiles(apiRoot);
    expect(routes.length).toBeGreaterThan(0);
    const actionRoutes = routes.filter((file) =>
      /^\s*(["'])use server\1\s*;/.test(readFileSync(file, "utf8")),
    );
    expect(actionRoutes.map((file) => relative(apiRoot, file))).toEqual([]);
  });

  it("keeps the CLI status batch callable and isolates a failing tool", async () => {
    const tools = ["claude", "codex", "opencode", "droid", "openclaw", "hermes",
      "cowork", "cline", "kilo", "deepseek-tui", "jcode", "grok-build", "devin",
      "pi", "omp", "crush", "forge", "smelt", "codewhale"];
    const paths = tools.map((tool) => join(apiRoot, "cli-tools", `${tool}-settings`, "route.js"));
    const getters = tools.map((tool) => vi.fn(async () => {
      if (tool === "claude") throw new Error("test tool unavailable");
      return Response.json({ tool, installed: true });
    }));
    vi.resetModules();
    paths.forEach((path, i) => vi.doMock(path, () => ({ GET: getters[i] })));
    try {
      const { GET } = await import("../../src/app/api/cli-tools/all-statuses/route.js");
      const response = await GET();
      expect(response.status).toBe(200);
      const statuses = await response.json();
      expect(Object.keys(statuses).sort()).toEqual([...tools].sort());
      expect(statuses.claude).toBeNull();
      for (const tool of tools.filter((tool) => tool !== "claude")) {
        expect(statuses[tool]).toEqual({ tool, installed: true });
      }
      getters.forEach((get) => expect(get).toHaveBeenCalledOnce());
    } finally {
      paths.forEach((path) => vi.doUnmock(path));
      vi.resetModules();
    }
  });
});

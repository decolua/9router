import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const serverPath = path.resolve(process.cwd(), "../src/mitm/server.js");
const source = fs.readFileSync(serverPath, "utf8");

describe("Antigravity MITM routing", () => {
  it("bypasses the legacy antigravity interceptor after model mapping", () => {
    expect(source).toContain('if (tool === "antigravity") {');
    expect(source).toContain('return passthrough(req, res, bodyBuffer);');
  });
});

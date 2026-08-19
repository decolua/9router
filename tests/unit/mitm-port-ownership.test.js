import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/mitm/server.js", import.meta.url)),
  "utf8",
);
const managerSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/mitm/manager.js", import.meta.url)),
  "utf8",
);

describe("MITM port ownership", () => {
  it("never kills an arbitrary process that happens to listen on port 443", () => {
    expect(serverSource).not.toContain("function killPort(");
    expect(serverSource).not.toMatch(/taskkill|powershell|netstat/i);
    expect(serverSource).toContain("Port ownership is resolved by the manager");
  });

  it("keeps explicit owner detection in the manager for intentional force-stop", () => {
    expect(managerSource).toContain("function getPort443Owner");
    expect(managerSource).toContain("async function killPort443Owner");
    expect(managerSource).toContain("forceKillPort443");
  });
});

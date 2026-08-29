import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("production launch contract", () => {
  it("installs the custom HTTP wrapper for Node, Bun, CLI, and Docker", () => {
    const pkg = JSON.parse(read("package.json"));
    const cli = read("cli/cli.js");
    const cliBuild = read("cli/scripts/build-cli.js");
    const dockerfile = read("Dockerfile");
    const envExample = read(".env.example");
    const customServer = read("custom-server.js");

    expect.soft(pkg.scripts.start).toBe("node custom-server.js");
    expect.soft(pkg.scripts["start:bun"]).toBe("bun custom-server.js");
    expect.soft(cli).toContain('path.join(standaloneDir, "custom-server.js")');
    expect.soft(cli).toContain("const serverPath = customServerPath;");
    expect.soft(cliBuild).toContain('path.join(cliAppDir, "client-ip.js")');
    expect.soft(dockerfile).toContain("COPY --from=builder /app/client-ip.js ./client-ip.js");
    expect.soft(dockerfile).toContain('CMD ["node", "custom-server.js"]');
    expect.soft(envExample).toContain("TRUST_PROXY=false");
    expect.soft(customServer).toContain('require("next/dist/bin/next")');
    expect.soft(customServer).not.toContain(".next/standalone/server.js");
  });
});

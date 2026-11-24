import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const coworkSource = fs.readFileSync(
  path.resolve(here, "../../src/app/(dashboard)/dashboard/cli-tools/components/CoworkToolCard.js"),
  "utf8"
);

describe("Cowork combo creation", () => {
  it("forwards an intelligence combo configuration created through the shared form", () => {
    expect(coworkSource).toContain("const handleCreateCombo = async ({ name, models, config })");
    expect(coworkSource).toContain("body: JSON.stringify({ name, models, config })");
  });
});

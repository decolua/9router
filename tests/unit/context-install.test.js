import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const card = fs.readFileSync(
  path.join(ROOT, "src/app/(dashboard)/dashboard/usage/components/AvailableModelsCard.js"),
  "utf8"
);
const route = fs.readFileSync(
  path.join(ROOT, "src/app/api/usage/available-models/route.js"),
  "utf8"
);
const config = fs.readFileSync(
  path.join(ROOT, "src/shared/constants/config.js"),
  "utf8"
);

describe("key catalog shows context, not the upstream account", () => {
  it("stops naming the studio on every row", () => {
    expect(card).not.toMatch(/originLabel/);
    expect(card).not.toContain('"Studio"');
  });

  it("renders the context window per model instead", () => {
    expect(card).toContain("contextLabel");
    expect(card).toContain("contextWindow");
    expect(card).toMatch(/M context|K context/);
  });

  it("the route attaches a numeric context window to each entry", () => {
    expect(route).toContain("contextWindow");
    expect(route).toContain("getCapabilitiesForModel");
  });

  it("combos report the smallest member window, never a guess", () => {
    expect(route).toMatch(/Math\.min\(\.\.\.windows\)/);
    expect(route).toContain("getCapabilitiesForModel");
  });
});

describe("update banner installs the fork, not upstream npm", () => {
  it("the published command points at the fork repository", () => {
    expect(config).toContain("github:serenhope/9router");
    expect(config).toContain("installCmdLatest");
  });

  it("no longer hands out the upstream npm package name", () => {
    expect(config).not.toMatch(/npm i -g 9router(@latest)?[\"'\s]/);
    expect(config).not.toContain("--prefer-online");
  });
});
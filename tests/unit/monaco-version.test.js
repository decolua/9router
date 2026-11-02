// The dashboard editor loads Monaco from a CDN, not node_modules (see
// src/shared/constants/monaco.js). Keep the pinned CDN version, the package.json range
// and the installed package in step so a dependency bump changes what users run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MONACO_VERSION, MONACO_VS_PATH } from "@/shared/constants/monaco.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const rootPkg = readJson("../../package.json");
// Read the manifest by path: monaco-editor's exports map may not expose ./package.json.
const installedVersion = (name) => readJson(`../../node_modules/${name}/package.json`).version;

describe("Monaco editor version pin", () => {
  it("matches the monaco-editor version installed from package.json", () => {
    expect(installedVersion("monaco-editor")).toBe(MONACO_VERSION);
    expect(rootPkg.dependencies["monaco-editor"]).toBe(`^${MONACO_VERSION}`);
  });

  it("loads that exact version's AMD build from jsdelivr", () => {
    expect(MONACO_VS_PATH).toBe(`https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`);
  });
});

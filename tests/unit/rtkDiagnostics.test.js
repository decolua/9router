import { describe, expect, it } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { compressMessages } from "../../open-sse/rtk/index.js";

function makeTscOutput(count = 40) {
  return Array.from({ length: count }, (_, i) => (
    `src/file${i % 5}.ts(${i + 1},${(i % 8) + 1}): error TS2322: Type 'string' is not assignable to type 'number' with repeated diagnostic context ${"x".repeat(40)}.\n` +
    `  Property 'value${i}' is incompatible with target type ${"detail ".repeat(10)}.`
  )).join("\n");
}

function makeMypyOutput(count = 40) {
  const lines = Array.from({ length: count }, (_, i) => (
    `src/mod${i % 4}.py:${i + 1}: error: Incompatible return value type (got "str", expected "int")  [return-value]`
  ));
  lines.push(`Found ${count} errors in 4 files`);
  return lines.join("\n");
}

describe("RTK latest diagnostic filters", () => {
  it("auto-detects TypeScript diagnostics through compressMessages", () => {
    const input = makeTscOutput();
    const body = { messages: [{ role: "tool", content: input }] };

    const stats = compressMessages(body, true);

    expect(stats.hits[0].filter).toBe("typescript");
    expect(body.messages[0].content).toContain("TypeScript:");
    expect(body.messages[0].content.length).toBeLessThan(input.length);
  });

  it("auto-detects mypy diagnostics through compressMessages", () => {
    const input = makeMypyOutput();
    const body = { messages: [{ role: "tool", content: input }] };

    const stats = compressMessages(body, true);

    expect(stats.hits[0].filter).toBe("mypy");
    expect(body.messages[0].content).toContain("mypy:");
    expect(body.messages[0].content.length).toBeLessThan(input.length);
  });

  it("exposes pytest, vitest, and go-test detectors", () => {
    const pytest = "=== test session starts ===\ncollected 2 items\n\n=== 2 passed in 0.10s ===";
    const vitest = " Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  44ms";
    const go = "{\"Time\":\"2026-01-01T00:00:00Z\",\"Action\":\"pass\",\"Package\":\"x\",\"Test\":\"TestA\"}\n";

    expect(autoDetectFilter(pytest).filterName).toBe("pytest");
    expect(autoDetectFilter(vitest).filterName).toBe("vitest");
    expect(autoDetectFilter(go).filterName).toBe("go-test");
  });
});

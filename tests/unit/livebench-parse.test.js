import { describe, expect, it } from "vitest";
import { parseLiveBenchCsv, splitCsvLine, candidateDates } from "../../src/lib/rankings/livebench.js";

describe("csv splitting", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    // Model names do contain commas; naive splitting shifts every later column.
    expect(splitCsvLine('"gpt-4o, preview",90,80')).toEqual(["gpt-4o, preview", "90", "80"]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"say ""hi""",1')).toEqual(['say "hi"', "1"]);
  });

  it("preserves empty trailing fields", () => {
    expect(splitCsvLine("a,,")).toEqual(["a", "", ""]);
  });
});

describe("LiveBench table parsing", () => {
  const CSV = [
    "model,AMPS_Hard,code_generation,python,zebra_puzzle,summarize",
    "model-strong,90,80,70,60,50",
    "model-weak,10,20,30,40,50",
  ].join("\n");

  it("parses one record per model", () => {
    const { models, count } = parseLiveBenchCsv(CSV);
    expect(count).toBe(2);
    expect(models.map((m) => m.slug)).toEqual(["model-strong", "model-weak"]);
  });

  it("scores a model as the mean of its task columns", () => {
    const { models } = parseLiveBenchCsv(CSV);
    // (90+80+70+60+50)/5
    expect(models[0].score).toBe(70);
    expect(models[0].taskCount).toBe(5);
  });

  it("groups task columns into categories", () => {
    const { models } = parseLiveBenchCsv(CSV);
    // coding = code_generation + python
    expect(models[0].categories.coding).toBe(75);
    expect(models[0].categories.math).toBe(90);
    expect(models[0].categories.reasoning).toBe(60);
  });

  it("ignores non-numeric cells rather than scoring them as zero", () => {
    const { models } = parseLiveBenchCsv("model,a,b\nm1,50,N/A");
    expect(models[0].score).toBe(50);
    expect(models[0].taskCount).toBe(1);
  });

  it("skips rows with no name or no numeric scores", () => {
    const { models } = parseLiveBenchCsv("model,a\n,50\nm2,\nm3,80");
    expect(models.map((m) => m.slug)).toEqual(["m3"]);
  });

  it("returns empty for a table with no model column or no rows", () => {
    expect(parseLiveBenchCsv("foo,bar\n1,2").count).toBe(0);
    expect(parseLiveBenchCsv("model,a").count).toBe(0);
    expect(parseLiveBenchCsv("").count).toBe(0);
    expect(parseLiveBenchCsv(null).count).toBe(0);
  });

  it("tolerates a column set that changed between releases", () => {
    // Categories present are computed; absent ones are simply omitted.
    const { models } = parseLiveBenchCsv("model,python\nm1,42");
    expect(models[0].categories.coding).toBe(42);
    expect(models[0].categories.math).toBeUndefined();
  });
});

describe("publication date discovery", () => {
  it("walks back month by month, newest first", () => {
    const dates = candidateDates(new Date(2026, 2, 10), 3);
    expect(dates).toEqual(["2026_03_25", "2026_02_25", "2026_01_25"]);
  });

  it("crosses a year boundary", () => {
    expect(candidateDates(new Date(2026, 0, 5), 2)).toEqual(["2026_01_25", "2025_12_25"]);
  });
});

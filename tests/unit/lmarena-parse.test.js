import { describe, expect, it } from "vitest";
import { parseLmArenaHtml, slugFromModelCell, scoreFromCell } from "../../src/lib/rankings/lmarena.js";

const row = (rank, model, score) =>
  `<tr><td>${rank}</td><td>1 1</td><td>${model}</td><td>${score}</td><td>4,932</td></tr>`;

describe("LMArena cell parsing", () => {
  it("extracts the slug from a decorated model cell", () => {
    // The cell carries a vendor label and licence around the actual id.
    expect(slugFromModelCell("Anthropic claude-opus-4-6-high Anthropic · Proprietary"))
      .toBe("claude-opus-4-6-high");
    expect(slugFromModelCell("gemini-4-argon-high Google · Proprietary")).toBe("gemini-4-argon-high");
  });

  it("returns null when the cell has no usable id", () => {
    expect(slugFromModelCell("Google · Proprietary")).toBe(null);
    expect(slugFromModelCell("")).toBe(null);
  });

  it("reads a score and its ± spread as an interval", () => {
    // The interval is what lets the consensus call two models a draw instead of
    // awarding a win off a difference the board itself calls noise.
    expect(scoreFromCell("1525 ±9 Preliminary")).toEqual({ score: 1525, ciLow: 1516, ciHigh: 1534 });
    expect(scoreFromCell("1505 ±3")).toEqual({ score: 1505, ciLow: 1502, ciHigh: 1508 });
  });

  it("still reads a score with no spread", () => {
    expect(scoreFromCell("1400")).toEqual({ score: 1400 });
  });

  it("returns null for a non-numeric cell", () => {
    expect(scoreFromCell("Score")).toBe(null);
  });
});

describe("LMArena table parsing", () => {
  const HTML = [
    "<table><thead>",
    "<tr><th>Rank</th><th>Rank Spread</th><th>Model</th><th>Score</th><th>Votes</th></tr>",
    "</thead><tbody>",
    row(1, "gemini-4-argon-high Google · Proprietary", "1525 ±9"),
    row(2, "Anthropic claude-opus-4-6-high Anthropic · Proprietary", "1505 ±3"),
    "</tbody></table>",
  ].join("");

  it("parses one entry per data row", () => {
    const { models, count } = parseLmArenaHtml(HTML);
    expect(count).toBe(2);
    expect(models.map((m) => m.slug)).toEqual(["gemini-4-argon-high", "claude-opus-4-6-high"]);
  });

  it("skips the header row", () => {
    const { models } = parseLmArenaHtml(HTML);
    expect(models.some((m) => m.slug === "rank")).toBe(false);
  });

  it("carries the interval through", () => {
    const { models } = parseLmArenaHtml(HTML);
    expect(models[0].ciLow).toBe(1516);
    expect(models[0].ciHigh).toBe(1534);
  });

  it("skips rows with too few cells or unparseable values", () => {
    const { count } = parseLmArenaHtml(
      "<tr><td>1</td><td>x</td></tr>" +
      "<tr><td>2</td><td>a</td><td>no-slug-here</td><td>Score</td></tr>",
    );
    expect(count).toBe(0);
  });

  it("handles empty or missing markup", () => {
    expect(parseLmArenaHtml("").count).toBe(0);
    expect(parseLmArenaHtml(null).count).toBe(0);
  });
});

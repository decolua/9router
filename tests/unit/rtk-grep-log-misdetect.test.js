// Audit item: RTK misdetected timestamped logs as grep output. autoDetectFilter
// picked `grep` when ANY of the first five non-empty lines looked like
// "x:NN:y" — a timestamp ("2026-11-10 12:30:45 INFO ...") qualifies — and the
// grep filter then dropped every non-matching line, deleting the ERROR line
// from a 120-line log. Detection must require a clear majority of real
// "path:line:content" lines, and the grep filter must fail open (return its
// input unchanged) when any non-empty line does not parse.
import { describe, expect, it } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { grep } from "../../open-sse/rtk/filters/grep.js";
import { compressMessages } from "../../open-sse/rtk/index.js";

function timestampedLog(lines = 120, errorLine = 77) {
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ss = String(i % 60).padStart(2, "0");
    out.push(`2026-11-10 12:${ss}:${ss} INFO worker-${i} processed job ${i}`);
  }
  out[errorLine] = "2026-11-10 12:17:00 ERROR MARKER-LINE-77 payment failed for order 991";
  return out.join("\n");
}

describe("RTK grep detection vs timestamped logs", () => {
  it("does not classify a timestamped log as grep output", () => {
    const fn = autoDetectFilter(timestampedLog());
    expect(fn?.filterName).not.toBe("grep");
  });

  it("keeps every line of a timestamped log through compressMessages", () => {
    const text = timestampedLog();
    const body = {
      messages: [
        { role: "user", content: "check logs" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text }] },
      ],
    };
    const stats = compressMessages(body, true);

    expect(stats.hits).toEqual([]);
    expect(body.messages[2].content[0].content).toBe(text);
    expect(body.messages[2].content[0].content).toContain("MARKER-LINE-77");
  });

  it("still detects real grep output whose content contains a timestamp", () => {
    const input = [
      "logs/app.log:77:2026-11-10 12:17:00 ERROR payment failed",
      "logs/app.log:78:2026-11-10 12:17:01 INFO retrying",
      "src/foo.js:12:const x = 1",
    ].join("\n");
    expect(autoDetectFilter(input)?.filterName).toBe("grep");
  });

  it("grep filter returns its input unchanged when a non-empty line does not parse", () => {
    const input = [
      "src/foo.js:1:first match",
      "src/foo.js:2:second match",
      "2026-11-10 12:30:45 INFO not a grep hit",
    ].join("\n");
    expect(grep(input)).toBe(input);
  });

  it("grep filter still compacts a fully grep-shaped dump", () => {
    const input = Array.from({ length: 40 }, (_, i) => `src/foo.js:${i + 1}:const x${i} = ${i};`).join("\n");
    const out = grep(input);
    expect(out).toContain("40 matches in 1F:");
    expect(out.length).toBeLessThan(input.length);
  });
});

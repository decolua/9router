import { describe, expect, it } from "vitest";
import { parseJudgeResult } from "@/shared/utils/judgeResult.js";

describe("expert panel judge result parser", () => {
  it("parses fenced JSON with leading explanation and string scores", () => {
    const result = parseJudgeResult('评分如下：\n```json\n{"results":[{"name":"model-a","rating":"88","reason":"完整"}],"summary":"A 更好"}\n```');
    expect(result).toEqual({
      scores: [{ model: "model-a", score: 88, comment: "完整" }],
      summary: "A 更好",
    });
  });

  it("parses an array response with alternate keys", () => {
    expect(parseJudgeResult('[{"candidate":"model-b","value":76,"feedback":"清晰"}]').scores)
      .toEqual([{ model: "model-b", score: 76, comment: "清晰" }]);
  });

  it("rejects content without any usable scores", () => {
    expect(() => parseJudgeResult('{"summary":"没有分数"}')).toThrow("裁判模型未返回有效评分");
  });
});

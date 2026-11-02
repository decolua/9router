import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddy parseError", () => {
  it("parses code 6004 frequency limit with timestamp into 429 and resetsAtMs on codebuddy-cn", () => {
    const executor = new CodeBuddyExecutor();
    const bodyText = JSON.stringify({
      code: 6004,
      message: "当前模型超出频率限制，请于 2026-09-28 14:30:00 后重试",
    });

    const parsed = executor.parseError({ status: 200 }, bodyText);
    expect(parsed.status).toBe(429);
    expect(parsed.message).toContain("超出频率限制");
    expect(parsed.resetsAtMs).toBeTruthy();
    expect(typeof parsed.resetsAtMs).toBe("number");

    // 验证时区解析 (默认 UTC+8)
    const expected = new Date("2026-09-28T14:30:00+08:00").getTime();
    expect(parsed.resetsAtMs).toBe(expected);
  });

  it("parses frequency limit text match without code 6004 on codebuddy-intl", () => {
    const executor = new CodeBuddyIntlExecutor();
    const bodyText = JSON.stringify({
      code: 11000,
      msg: "frequency limit exceeded, please retry after 2026-09-28 12:00:00 UTC+0",
    });

    const parsed = executor.parseError({ status: 400 }, bodyText);
    expect(parsed.status).toBe(429);
    expect(parsed.message).toContain("frequency limit");
    const expected = new Date("2026-09-28T12:00:00+00:00").getTime();
    expect(parsed.resetsAtMs).toBe(expected);
  });

  it("falls back to super.parseError for unrelated errors", () => {
    const executor = new CodeBuddyExecutor();
    const bodyText = JSON.stringify({
      code: 11101,
      message: "Non-stream chat request is currently not supported",
    });

    const parsed = executor.parseError({ status: 400 }, bodyText);
    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe(bodyText);
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});

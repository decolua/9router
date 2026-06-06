import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../../src/shared/utils/sanitizeHtml.js";

describe("sanitizeHtml", () => {
  it("removes executable tags and event handlers", () => {
    const html = sanitizeHtml('<h2 onclick="alert(1)">Release</h2><script>alert(2)</script><p>ok</p>');

    expect(html).toContain("<h2>Release</h2>");
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
  });

  it("removes javascript urls", () => {
    const html = sanitizeHtml('<a href="javascript:alert(1)">bad</a><a href="https://9router.com">good</a>');

    expect(html).toContain("<a>bad</a>");
    expect(html).toContain('<a href="https://9router.com">good</a>');
    expect(html).not.toContain("javascript:");
  });

  it("removes obfuscated dangerous urls in fallback mode", () => {
    const html = sanitizeHtml('<a href="java\nscript:alert(1)">bad</a><img src=data:text/html,<script>alert(1)</script>><a href="https://9router.com">good</a>');

    expect(html).toContain("<a>bad</a>");
    expect(html).toContain("<img>");
    expect(html).toContain('<a href="https://9router.com">good</a>');
    expect(html).not.toContain("java\nscript:");
    expect(html).not.toContain("data:text/html");
  });
});

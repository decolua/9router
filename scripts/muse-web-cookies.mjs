import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { toMuseCookies } from "../open-sse/executors/muse-web/session.js";
import { toPlaywrightCookies } from "../open-sse/utils/webCookieAuth.js";

const browser = await chromium.launch({ headless: true });
try {
  for (const convert of [toMuseCookies, (header) => toPlaywrightCookies(header, ".muse.ai")]) {
    const context = await browser.newContext();
    try {
      await context.addCookies(convert("hatch_sess=session; __Host-session=first; __Secure-token=a=b; Path=/; Secure"));
      await context.addCookies(convert("__Host-session=renewed"));
      const root = await context.cookies("https://muse.ai/");
      assert.equal(root.find((cookie) => cookie.name === "__Host-session")?.value, "renewed");
      assert.equal(root.find((cookie) => cookie.name === "__Secure-token")?.value, "a=b");
      const subdomain = await context.cookies("https://sub.muse.ai/");
      assert.equal(subdomain.some((cookie) => cookie.name === "__Host-session"), false);
      assert.equal(subdomain.find((cookie) => cookie.name === "hatch_sess")?.value, "session");
      assert.equal(root.some((cookie) => cookie.name === "Path"), false);
    } finally {
      await context.close();
    }
  }
  console.log("Muse cookie seeding and renewal: accepted; host-only scope preserved.");
} finally {
  await browser.close();
}

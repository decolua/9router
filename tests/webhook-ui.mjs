// Run: bun --no-env-file tests/webhook-ui.mjs http://127.0.0.1:20128
// Optional: PLAYWRIGHT_CORE_PATH=/absolute/path/to/playwright-core/index.mjs
// Optional: WEBHOOK_UI_CDP_URL=http://127.0.0.1:9333 (standard Chrome CDP; supports Node)
// Screenshots go to a unique temporary directory, or WEBHOOK_UI_SCREENSHOTS.
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const base = new URL(process.argv[2] || "http://127.0.0.1:20128");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use an isolated loopback app");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const screenshots = process.env.WEBHOOK_UI_SCREENSHOTS || await mkdtemp(join(tmpdir(), "webhook-ui-"));
await mkdir(screenshots, { recursive: true });
let browser;
if (process.env.WEBHOOK_UI_CDP_URL) {
  browser = await chromium.connectOverCDP(process.env.WEBHOOK_UI_CDP_URL, { timeout: 10000 });
} else {
  // Bun's native WebSocket avoids the bundled ws client's Obscura handshake timeout.
  const socket = new WebSocket("ws://127.0.0.1:9222/devtools/browser");
  /** @type {import("playwright-core").ConnectOverCDPTransport} */
  const transport = {
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
  };
  socket.addEventListener("message", (event) => transport.onmessage?.(JSON.parse(event.data)));
  socket.addEventListener("close", (event) => transport.onclose?.(event.reason));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  browser = await chromium.connectOverCDP(transport, { timeout: 10000 });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
const keyboard = await context.newCDPSession(page);
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const destinations = [{
  id: "dummy-generic", name: "Regression receiver", kind: "generic", revision: 7,
  enabled: false, events: ["request.failed"], cooldownSeconds: 300,
  allowPrivateNetwork: false, url: { scheme: "https", host: "receiver.example.invalid" },
  hasSigningSecret: true, headerCount: 1,
}];
const deliveries = [{
  id: "dummy-delivery", destinationId: "dummy-generic", type: "request.failed",
  deliveryKind: "test", status: "pending", attempts: 0, createdAt: "2026-10-26T12:00:00Z",
}];
const health = { queue: { pending: 1, inflight: 0, retry: 0, failed: 0 }, degraded: { enqueueFailures: 0 } };

// Intercept fetch before React mounts: no API calls or webhook sends leave the page.
// Native DOM actions avoid Obscura's incomplete Playwright injected-script support.
await context.addInitScript(({ destinations, deliveries, health }) => {
  window.webhookRegression = { destinations, writes: [], reads: [], failSave: false, holdWrite: false };
  window.webhookButton = (name) => [...document.querySelectorAll("button")].filter((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"],.material-symbols-outlined').forEach((icon) => icon.remove());
    return (element.getAttribute("aria-label") || copy.textContent.replace(/\s+/g, " ").trim()) === name;
  });
  window.fetch = async (input, options = {}) => {
    const state = window.webhookRegression;
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/webhooks")) {
      throw new Error(`Unmocked fetch: ${url.pathname}`);
    }
    const path = url.pathname.slice("/api/webhooks".length);
    const method = options.method || "GET";
    if (method === "GET") {
      state.reads.push(path);
      if (path === "" && state.holdRead) await new Promise((resolve) => { state.releaseRead = resolve; });
      return Response.json(path === "" ? { destinations: state.destinations } : { deliveries, health });
    }
    const body = JSON.parse(options.body);
    state.writes.push({ method, path, body });
    if (state.holdWrite) await new Promise((resolve) => { state.releaseWrite = resolve; });
    if (state.failSave) return Response.json({ error: "dummy failure" }, { status: 500 });
    if (path.endsWith("/test")) return Response.json({ deliveryId: "dummy-queued-test" }, { status: 202 });
    if (method === "POST") state.destinations.push({ ...destinations[0], ...body, id: "dummy-created", revision: 1 });
    if (method === "PATCH") state.destinations = state.destinations.map((item) => path === `/${item.id}` ? { ...item, ...body, revision: item.revision + 1 } : item);
    if (method === "DELETE") state.destinations = state.destinations.filter((item) => path !== `/${item.id}`);
    return Response.json({ success: true });
  };
}, { destinations, deliveries, health });

async function wait(check) {
  const deadline = Date.now() + 10000;
  while (!await check()) {
    assert(Date.now() < deadline, "Timed out waiting for rendered UI");
    await sleep(50);
  }
}
const button = (name) => ({
  click: async () => {
    await button(name).waitFor();
    await page.evaluate((name) => {
      const matches = window.webhookButton(name).filter((element) => !element.disabled && element.getClientRects().length);
      if (matches.length !== 1) throw new Error(`Expected one enabled visible button: ${name}, got ${matches.length}`);
      matches[0].focus(); matches[0].click();
    }, name);
  },
  waitFor: () => wait(() => page.evaluate((name) => window.webhookButton(name).some((e) => !e.disabled && e.getClientRects().length), name)),
  isEnabled: () => page.evaluate((name) => window.webhookButton(name).some((e) => !e.disabled && e.getClientRects().length), name),
});
const field = (name) => {
  const value = () => page.evaluate((name) => [...document.querySelectorAll("label")].find((e) => [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim() === name)?.querySelector("input,select")?.value, name);
  const fill = async (value) => {
    await wait(async () => await field(name).inputValue() !== undefined);
    await page.evaluate(({ name, value }) => {
      const element = [...document.querySelectorAll("label")].find((e) => [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim() === name).querySelector("input,select");
      Object.getOwnPropertyDescriptor(element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }, { name, value });
  };
  return { inputValue: value, fill, selectOption: fill, check: () => page.evaluate((name) => {
    const element = [...document.querySelectorAll("label")].find((e) => e.textContent.trim() === name).querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set.call(element, true);
    element.dispatchEvent(new Event("click", { bubbles: true }));
  }, name) };
};
const lastWrite = () => page.evaluate(() => window.webhookRegression.writes.at(-1));
const writeCount = () => page.evaluate(() => window.webhookRegression.writes.length);
const dialogOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'));
async function key(key, modifiers = 0) {
  await keyboard.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, modifiers, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 });
  await keyboard.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 });
}
async function dialogFocus() {
  await wait(dialogOpen);
  assert.equal(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const title = dialog.getAttribute("aria-labelledby");
    const name = title ? document.getElementById(title)?.textContent.trim() : dialog.getAttribute("aria-label")?.trim();
    return !!(name && dialog.contains(document.activeElement));
  }), true, "Named modal must receive focus");
  await page.evaluate(() => {
    const elements = [...document.querySelector('[role="dialog"]').querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter((e) => !e.disabled && e.getClientRects().length);
    elements.at(-1).focus();
  });
  await key("Tab");
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true, "CDP Tab must stay inside modal");
  await key("Tab", 8);
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true, "CDP Shift+Tab must stay inside modal");
}
async function busyDismiss() {
  await wait(() => page.evaluate(() => typeof window.webhookRegression.releaseWrite === "function"));
  await key("Escape");
  await page.evaluate(() => {
    window.webhookButton("Close").forEach((element) => element.click());
    const dialog = document.querySelector('[role="dialog"]');
    const overlay = (dialog?.closest(".fixed") || dialog?.querySelector(".fixed"))?.querySelector(".absolute.inset-0");
    if (!overlay) throw new Error("Modal overlay not found");
    overlay.click();
  });
  assert.equal(await dialogOpen(), true, "Busy modal must reject Escape, close and overlay dismissal");
  await page.evaluate(() => { window.webhookRegression.holdWrite = false; window.webhookRegression.releaseWrite(); delete window.webhookRegression.releaseWrite; });
}
async function save() {
  const before = await page.evaluate(() => window.webhookRegression.writes.length);
  await button("Save destination").click();
  await wait(() => page.evaluate((before) => window.webhookRegression.writes.length > before, before));
  await wait(() => page.evaluate(() => document.querySelector('[role="alert"]') || !document.querySelector("form")));
}
async function capture(state) {
  for (const [size, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).forEach((animation) => animation.finish());
        document.querySelector('[role="dialog"] input')?.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      if (state === "create-form" && size === "mobile" && theme === "light") {
        const evidence = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const shell = dialog.querySelector(".fixed");
          const panel = shell.querySelector(".relative");
          const input = dialog.querySelector("input");
          const rect = input.getBoundingClientRect();
          const style = (element) => {
            const css = getComputedStyle(element);
            return { opacity: css.opacity, background: css.backgroundColor, zIndex: css.zIndex, transform: css.transform, position: css.position, color: css.color };
          };
          const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          return { shell: style(shell), panel: style(panel), input: { ...style(input), value: input.value, rect: rect.toJSON() }, viewport: { width: innerWidth, height: innerHeight, scrollY }, point, hits: document.elementsFromPoint(point.x, point.y).slice(0, 5).map((element) => ({ tag: element.tagName, class: element.className, insideDialog: dialog.contains(element), text: element.textContent.slice(0, 80) })), inputHit: document.elementFromPoint(point.x, point.y) === input, animations: document.getAnimations().map((animation) => ({ state: animation.playState, time: animation.currentTime })) };
        });
        console.log("Modal paint evidence:", evidence);
        assert.equal(evidence.inputHit, true, "Create modal input must receive pointer hit at its center (mobile/light); modal wrapper must not block it");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${state}/${size}/${theme}: page overflow`);
      await page.screenshot({ path: join(screenshots, `${state}-${size}-${theme}.png`), fullPage: true, animations: "disabled" });
    }
  }
}

try {
  await page.goto(new URL("/dashboard/webhooks", base).href, { waitUntil: "commit" });
  await button("Edit Regression receiver").waitFor();
  await wait(() => page.evaluate(() => !!document.querySelector('[aria-label="Latest webhook deliveries"]')));
  await capture("baseline");
  const refreshAccessible = await page.evaluate(() => {
    const refresh = window.webhookButton("Refresh destinations");
    return refresh.length === 1 && !!refresh[0].querySelector('[aria-hidden="true"]') && refresh[0].textContent.includes("Refresh");
  });
  console.log("Refresh decorative icon accessibility:", refreshAccessible);
  const reads = await page.evaluate(() => window.webhookRegression.reads.filter((path) => path === "").length);
  await button("Refresh destinations").click();
  await wait(() => page.evaluate((before) => window.webhookRegression.reads.filter((path) => path === "").length > before, reads));
  await button("Refresh destinations").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const metadataGeometry = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h3")].find((element) => element.textContent === "Regression receiver");
    return {
      viewport: innerWidth,
      metadata: heading.parentElement.parentElement.getBoundingClientRect().width,
      row: heading.closest("li").getBoundingClientRect().width,
    };
  });
  assert.equal(metadataGeometry.viewport, 390);
  assert(metadataGeometry.metadata >= metadataGeometry.row / 2, `Mobile destination metadata squeezed: ${JSON.stringify(metadataGeometry)}`);
  console.log("PASS mobile destination metadata width", metadataGeometry);

  await button("Add destination").click();
  await dialogFocus();
  await key("Escape");
  await wait(async () => !await dialogOpen());
  await wait(() => page.evaluate(() => window.webhookButton("Add destination")[0] === document.activeElement));
  assert.equal(await page.evaluate(() => window.webhookButton("Add destination")[0] === document.activeElement), true, "Create dismissal restores trigger focus");
  assert.equal(await writeCount(), 0, "Dismissing create must not write");
  await button("Add destination").click();
  await dialogFocus();
  await field("Name").fill("Dummy Discord");
  await field("Webhook URL").fill("https://discord.example.invalid/dummy-webhook");
  await capture("create-form");
  await page.evaluate(() => { window.webhookRegression.holdWrite = true; });
  await button("Save destination").click();
  await busyDismiss();
  await wait(async () => !await dialogOpen());
  assert.deepEqual(await lastWrite(), { method: "POST", path: "", body: {
    name: "Dummy Discord", kind: "discord", enabled: true, events: ["request.failed"],
    allowPrivateNetwork: false, cooldownSeconds: 300, url: "https://discord.example.invalid/dummy-webhook",
  } });
  await button("Edit Dummy Discord").waitFor();
  console.log("PASS create payload and default events");

  await button("Edit Regression receiver").click();
  await dialogFocus();
  await capture("edit-form");
  assert.equal(await field("Replace URL (leave blank to keep)").inputValue(), "");
  assert.equal(await field("Replace signing secret (leave blank to keep)").inputValue(), "");
  await save();
  assert.deepEqual(await lastWrite(), { method: "PATCH", path: "/dummy-generic", body: {
    name: "Regression receiver", kind: "generic", enabled: false, events: ["request.failed"],
    allowPrivateNetwork: false, cooldownSeconds: 300, expectedRevision: 7,
  } });
  console.log("PASS blank credentials omitted and expectedRevision retained");

  await button("Edit Regression receiver").click();
  await field("Headers").selectOption("replace");
  await field("Header 1 name").fill("X-Regression");
  await field("Header 1 value").fill("dummy-header-value");
  await field("Replace signing secret (leave blank to keep)").fill("dummy-signing-secret");
  await save();
  assert.deepEqual((await lastWrite()).body.headers, { "X-Regression": "dummy-header-value" });
  assert.equal((await lastWrite()).body.signingSecret, "dummy-signing-secret");
  assert.equal((await lastWrite()).body.expectedRevision, 8);
  console.log("PASS Generic JSON replacement");

  await button("Edit Regression receiver").click();
  await field("Headers").selectOption("clear");
  await field("Clear and regenerate signing secret (never unsigned)").check();
  await save();
  const cleared = (await lastWrite()).body;
  assert.equal(cleared.clearHeaders, true);
  assert.equal(cleared.clearSigningSecret, true);
  assert.equal(cleared.expectedRevision, 9);
  assert.equal("headers" in cleared || "signingSecret" in cleared, false);
  console.log("PASS Generic JSON explicit clear");

  await button("Send saved synthetic test to Regression receiver").click();
  await wait(() => page.evaluate(() => document.querySelector('[role="status"]').textContent.includes("dummy-queued-test")));
  assert.deepEqual(await lastWrite(), { method: "POST", path: "/dummy-generic/test", body: {} });
  assert.match(await page.evaluate(() => document.querySelector('[role="status"]').textContent), /queued.*does not mean delivered/i);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("td")].filter((e) => e.textContent.trim() === "pending").length), 1);
  console.log("PASS synthetic test is queued, not delivered, including disabled destination");

  await button("Delete Regression receiver").click();
  await dialogFocus();
  await capture("delete-confirmation");
  const beforeDelete = await writeCount();
  await button("Keep destination").click();
  await wait(async () => !await dialogOpen());
  assert.equal(await writeCount(), beforeDelete, "Delete cancellation must not write");
  await wait(() => page.evaluate(() => window.webhookButton("Delete Regression receiver")[0] === document.activeElement));
  assert.equal(await page.evaluate(() => window.webhookButton("Delete Regression receiver")[0] === document.activeElement), true, "Delete cancellation restores original trigger focus");
  assert.equal(await button("Edit Regression receiver").isEnabled(), true, "Cancelled destination remains editable");
  await button("Delete Regression receiver").click();
  await dialogFocus();
  await key("Escape");
  await wait(async () => !await dialogOpen());
  assert.equal(await writeCount(), beforeDelete, "Escape must cancel deletion");
  await button("Delete Regression receiver").click();
  await page.evaluate(() => { window.webhookRegression.holdWrite = true; window.webhookRegression.holdRead = true; });
  await button("Confirm delete").click();
  await busyDismiss();
  await wait(() => page.evaluate(() => document.querySelector('[role="status"]').textContent.includes("Destination deleted")));
  assert.deepEqual(await lastWrite(), { method: "DELETE", path: "/dummy-generic", body: { expectedRevision: 10 } });
  await wait(() => page.evaluate(() => typeof window.webhookRegression.releaseRead === "function"));
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.webhookRegression.holdRead = false;
    window.webhookRegression.releaseRead();
    delete window.webhookRegression.releaseRead;
  });
  await wait(() => page.evaluate(() => window.webhookButton("Delete Regression receiver").length === 0));
  assert.equal(await page.evaluate(() => window.webhookButton("Add destination")[0] === document.activeElement), true, "Successful deletion keeps Add focused after refreshed row disappears");
  console.log("PASS delete revision");

  await button("Add destination").click();
  await field("Name").fill("Keep my draft");
  await field("Webhook URL").fill("https://receiver.example.invalid/draft");
  await page.evaluate(() => { window.webhookRegression.failSave = true; });
  await save();
  await wait(() => page.evaluate(() => !!document.querySelector('[role="alert"]')));
  assert.equal(await dialogOpen(), true, "Save error must keep create dialog open");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role") === "alert" && !!document.activeElement.closest('[role="dialog"]')), true, "Save error receives focus inside dialog");
  assert.equal(await field("Name").inputValue(), "Keep my draft");
  assert.equal(await field("Webhook URL").inputValue(), "https://receiver.example.invalid/draft");
  assert.equal(await button("Save destination").isEnabled(), true);
  console.log("PASS server error retains editable draft");
  await capture("retained-error");
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(geometry.document <= geometry.viewport + 1, `Mobile page overflow: ${JSON.stringify(geometry)}`);
  assert.deepEqual(errors, [], "Browser runtime errors");
  assert.equal(refreshAccessible, true, "Refresh must have a decorative icon and visible text");
  console.log(`PASS mobile overflow; screenshots: ${screenshots}`);
} finally {
  console.log("Browser errors:", errors);
  await page.screenshot({ path: join(screenshots, "last-state.png"), fullPage: true });
  await context.close();
  await browser.close();
}

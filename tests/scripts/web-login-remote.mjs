import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdtemp, rm, mkdir, symlink, writeFile, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Run: node tests/scripts/web-login-remote.mjs (requires Chromium and Xvfb or DISPLAY).
// When this file is mounted separately, set WEB_LOGIN_CHECK_ROOT to the application root.
const root = process.env.WEB_LOGIN_CHECK_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(path.join(root, "package.json"));
const { WebSocket } = require("ws");
const bridge = require(path.join(root, "realtime/web-login-websocket.cjs"));
const dataDir = await mkdtemp(path.join(tmpdir(), "web-login-remote-"));
process.env.DATA_DIR = dataDir;
const { WEB_LOGIN_CONFIGS } = await import(pathToFileURL(path.join(root, "open-sse/services/webLoginConfig.js")));
const { startWebLogin, getWebLoginStatus, cancelWebLogin, listWebLoginProfiles, listBrowserProfiles, createBrowserProfile, renameBrowserProfile, deleteBrowserProfile, startBrowserSession, listBrowserSessions, getBrowserSession, closeBrowserSession } = await import(pathToFileURL(path.join(root, "open-sse/services/webLogin.js")));
const { stopVirtualDisplay } = await import(pathToFileURL(path.join(root, "open-sse/services/virtualDisplay.js")));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await predicate();
    if (found) return found;
    await delay(25);
  }
  throw new Error(`Timed out: ${description}`);
}
let secondLoads = 0;
const stalled = new Set();
const server = http.createServer((req, res) => {
  if (req.url === "/stall") { stalled.add(res); res.once("close", () => stalled.delete(res)); return; }
  if (req.url === "/second") secondLoads++;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const title = req.url === "/popup" ? "Popup" : req.url === "/second" ? "Second" : "Login fixture";
  res.end(`<!doctype html><title>${title}</title><style>
    body{height:2400px;background:linear-gradient(#def,#abc);font:20px sans-serif}
    input,button,a{position:fixed;left:32px;width:300px;height:40px;box-sizing:border-box}
    #entry{top:32px}#popup{top:100px}#next{top:160px}#done{top:220px}
    </style><input id="entry" aria-label="Credential"><button id="popup" onclick="window.open('/popup')">Popup</button>
    <a id="next" href="/second">Next</a><button id="done" onclick="if(document.querySelector('#entry').value==='remote-✓')document.cookie='remote_session=actual-browser-credential; Path=/'">Complete</button>
    <script>window.lastKey='';document.addEventListener('keydown',e=>window.lastKey=e.key)</script>`);
});
server.on("upgrade", (req, socket, head) => {
  if (!bridge(server, req, socket, head)) socket.destroy();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const wsUrl = (token) => `${origin.replace("http:", "ws:")}/api/providers/web-login/view?token=${encodeURIComponent(token)}`;
const sockets = [];
async function rejected(token, originHeader) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(token), originHeader === undefined ? {} : { origin: originHeader });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("Upgrade rejection stalled")); }, 5000);
    ws.on("error", () => {});
    ws.on("open", () => { clearTimeout(timer); ws.terminate(); reject(new Error("Unauthorized viewer accepted")); });
    ws.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      try { assert.equal(response.statusCode, 403); resolve(); } catch (error) { reject(error); }
    });
  });
}
async function connect(token) {
  const ws = new WebSocket(wsUrl(token), { origin });
  sockets.push(ws);
  const messages = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  ws.on("error", () => {});
  await once(ws, "open");
  return {
    ws, messages,
    send: (message) => ws.send(JSON.stringify(message)),
    pages: () => messages.findLast((message) => message.type === "pages"),
  };
}
async function click(viewer, x, y) {
  for (const event of ["mouseMoved", "mousePressed", "mouseReleased"]) viewer.send({ type: "mouse", event, x, y, button: event === "mouseMoved" ? "none" : "left", clickCount: 1, modifiers: 0 });
  await delay(75);
}
const provider = "remote-check";
WEB_LOGIN_CONFIGS[provider] = { loginUrl: `${origin}/`, cookieDomain: "127.0.0.1", tokenSources: [{ type: "cookie", name: "remote_session" }] };
let session;
let standalone;
try {
  assert.equal(bridge.isSameOrigin(origin, new URL(origin).host), true);
  assert.equal(bridge.isSameOrigin("https://example.com", "example.com:443"), true);
  assert.equal(bridge.isSameOrigin("https://example.com", "example.com.evil"), false);
  assert.equal(bridge.isSameOrigin("null", "localhost"), false);
  assert.deepEqual(listBrowserProfiles(), [{ name: "default", busy: false }], "default profile is created on first use");
  for (const invalid of ["", "../escape", "has space", "a.b", "a".repeat(41), "web-login", "zcode-captcha", {}, null]) {
    assert.throws(() => createBrowserProfile(invalid), (error) => error.status === 400);
  }
  assert.throws(() => renameBrowserProfile("default", "renamed"), (error) => error.status === 409);
  assert.throws(() => deleteBrowserProfile("default"), (error) => error.status === 409);
  createBrowserProfile("persisted");
  assert.throws(() => createBrowserProfile("persisted"), (error) => error.status === 409, "duplicate create conflicts");
  const profileRoot = path.join(dataDir, "browser-profiles");
  await writeFile(path.join(profileRoot, "persisted", "marker"), "saved-profile");
  renameBrowserProfile("persisted", "workspace");
  assert.equal(await readFile(path.join(profileRoot, "workspace", "marker"), "utf8"), "saved-profile", "rename retains persistent profile files");
  assert.ok(listWebLoginProfiles().includes("workspace"));
  createBrowserProfile("duplicate");
  assert.throws(() => renameBrowserProfile("workspace", "duplicate"), (error) => error.status === 409);
  deleteBrowserProfile("duplicate");
  assert.ok(!listWebLoginProfiles().includes("duplicate"));
  await mkdir(path.join(profileRoot, "web-login"));
  await mkdir(path.join(profileRoot, "zcode-captcha"));
  const outside = path.join(dataDir, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(profileRoot, "linked"));
  assert.ok(!listWebLoginProfiles().some((name) => ["web-login", "zcode-captcha", "linked"].includes(name)), "internal directories and symlinks are hidden");
  for (const operation of [() => createBrowserProfile("linked"), () => renameBrowserProfile("linked", "other"), () => deleteBrowserProfile("linked")]) {
    assert.throws(operation, (error) => error.status === 409, "symlink profiles are never managed");
  }
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", "http://user:password@localhost/", "http://localhost/" + "x".repeat(4096), null]) {
    await assert.rejects(() => startBrowserSession("workspace", url), (error) => error.status === 400);
  }
  session = await startWebLogin(provider, "remote-stream");
  const token = session.viewerToken;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(bridge.registry, globalThis[Symbol.for("9router.web-login")]);
  assert.equal(bridge.registry.tokens.get(token), session, "ESM service and CJS upgrade handler share the session");
  await rejected(token);
  await rejected(token, "https://evil.example");
  await rejected("x".repeat(43), origin);
  let viewer = await connect(token);
  const frame = await until(() => viewer.messages.find((message) => message.type === "frame"), "actual Chromium JPEG");
  assert.equal(frame.width, 1280);
  assert.equal(listBrowserProfiles().find(({ name }) => name === session.profile).busy, true);
  assert.throws(() => renameBrowserProfile(session.profile, "login-busy"), (error) => error.status === 409);
  assert.throws(() => deleteBrowserProfile(session.profile), (error) => error.status === 409, "login holds the same profile mutation lock");
  assert.equal(frame.height, 800);
  assert.equal(Buffer.from(frame.data, "base64").subarray(0, 2).toString("hex"), "ffd8");
  const mainPage = await until(() => session.context?.pages().find((page) => page.url() === `${origin}/`), "fixture navigation");
  const mainId = await until(() => viewer.pages()?.pages.find((page) => page.url === `${origin}/`)?.id, "page list");
  await click(viewer, 80, 50);
  viewer.send({ type: "text", text: "remote-✓" });
  await until(() => mainPage.inputValue("#entry").then((value) => value === "remote-✓"), "remote text insertion");
  for (const event of ["keyDown", "keyUp"]) viewer.send({ type: "key", event, key: "ArrowLeft", code: "ArrowLeft", modifiers: 0, windowsVirtualKeyCode: 37 });
  await until(() => mainPage.evaluate(() => window.lastKey === "ArrowLeft"), "remote key event");
  viewer.send({ type: "wheel", x: 1000, y: 700, deltaX: 0, deltaY: 550, modifiers: 0 });
  await until(() => mainPage.evaluate(() => window.scrollY > 0), "remote wheel event");
  await click(viewer, 70, 175);
  await until(() => mainPage.url() === `${origin}/second`, "remote link click");
  viewer.send({ type: "reload" });
  await until(() => secondLoads >= 2, "remote reload");
  viewer.send({ type: "back" });
  await until(() => mainPage.url() === `${origin}/`, "remote back");
  await click(viewer, 70, 115);
  const popup = await until(() => viewer.pages()?.pages.find((page) => page.url === `${origin}/popup`), "popup registration");
  assert.equal(viewer.pages().activePageId, popup.id, "new popup becomes active");
  viewer.send({ type: "page", id: mainId });
  await until(() => viewer.pages()?.activePageId === mainId, "original tab selection");
  viewer.send({ type: "page", id: popup.id });
  await until(() => viewer.pages()?.activePageId === popup.id, "popup tab selection");
  // Switching starts a fresh CDP screencast; let it attach before sending input.
  await delay(150);
  await click(viewer, 80, 50);
  viewer.send({ type: "text", text: "popup input" });
  const popupPage = session.context.pages().find((page) => page.url() === `${origin}/popup`);
  await until(() => popupPage.inputValue("#entry").then((value) => value === "popup input"), "popup receives remote text");
  const replaced = once(viewer.ws, "close");
  viewer = await connect(token);
  await replaced;
  assert.equal(session.status, "running", "viewer replacement does not cancel login");
  const invalidClosed = once(viewer.ws, "close");
  viewer.send({ type: "Runtime.evaluate", expression: "document.cookie='remote_session=forged'" });
  assert.equal((await invalidClosed)[0], 1008, "non-allowlisted CDP input closes only the viewer");
  assert.equal(session.status, "running");
  assert.equal(bridge.registry.tokens.get(token), session, "invalid viewer input does not revoke the login");
  viewer = await connect(token);
  const loginNavigateClosed = once(viewer.ws, "close");
  viewer.send({ type: "navigate", url: `${origin}/second` });
  assert.equal((await loginNavigateClosed)[0], 1008, "login sessions cannot use standalone navigation");
  assert.equal(mainPage.url(), `${origin}/`, "rejected login navigation leaves the page unchanged");
  assert.equal((await session.context.cookies()).some((cookie) => cookie.name === "remote_session"), false, "arbitrary CDP evaluation was not executed");
  viewer = await connect(token);
  viewer.ws.close();
  await once(viewer.ws, "close");
  assert.equal(session.status, "running", "viewer disconnect does not cancel login");
  viewer = await connect(token);
  await until(() => viewer.pages()?.pages.length === 2, "reconnect page list");
  viewer.send({ type: "page", id: mainId });
  await delay(150);
  await click(viewer, 80, 50);
  // Browser history restoration differs between Chrome releases; set the field solely through viewer input.
  for (const event of ["keyDown", "keyUp"]) viewer.send({ type: "key", event, key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  viewer.send({ type: "text", text: "remote-✓" });
  await until(() => mainPage.inputValue("#entry").then((value) => value === "remote-✓"), "credential field after reconnect");
  await click(viewer, 80, 235);
  await until(() => getWebLoginStatus(provider).status === "success", "live cookie harvest");
  assert.match(session.credential, /remote_session=actual-browser-credential/);
  assert.equal(session.viewerToken, null);
  await rejected(token, origin);
  await until(() => !bridge.registry.busyProfiles.has(session.profile), "success context closes before profile release");

  WEB_LOGIN_CONFIGS[provider].loginUrl = `${origin}/stall`;
  session = await startWebLogin(provider, "remote-stalled-navigation");
  const cancelledToken = session.viewerToken;
  await until(() => session.context?.pages()[0]?.url() === "about:blank" && stalled.size > 0, "stalled initial navigation");
  const started = Date.now();
  assert.equal(cancelWebLogin(provider), true);
  assert.equal(session.status, "cancelled");
  assert.ok(Date.now() - started < 500, "cancel never waits for navigation");
  assert.equal(session.viewerToken, null);
  await rejected(cancelledToken, origin);
  await until(() => !bridge.registry.busyProfiles.has(session.profile), "cancelled context cleanup");

  const pendingProfile = "remote-pending-launch";
  // mkdir happens immediately before the real launchPersistentContext call. Watching
  // it observes an in-flight launch, not merely cancellation before dependency loading.
  const launchStarted = new Promise((resolve, reject) => {
    const watcher = watch(path.join(dataDir, "browser-profiles"), (_event, name) => {
      if (name !== pendingProfile) return;
      clearTimeout(timer);
      watcher.close();
      resolve();
    });
    const timer = setTimeout(() => { watcher.close(); reject(new Error("Pending launch never created its profile")); }, 30000);
  });
  session = await startWebLogin(provider, pendingProfile);
  const pendingToken = session.viewerToken;
  assert.equal(session.context, null, "start responds before launching Chromium");
  await launchStarted;
  assert.equal(session.context, null, "cancellation occurs while the actual Chromium launch is pending");
  cancelWebLogin(provider);
  assert.equal(session.status, "cancelled");
  assert.equal(bridge.registry.busyProfiles.get(pendingProfile), session, "pending launch retains its profile lock after cancellation");
  await assert.rejects(() => startWebLogin(provider, pendingProfile), /already open/, "a cancelled launch cannot be replaced before it closes");
  await rejected(pendingToken, origin);
  await until(() => !bridge.registry.busyProfiles.has(session.profile), "late cancelled Chromium context closes before profile release");
  assert.equal(session.context, null);

  standalone = await startBrowserSession("workspace", `${origin}/`);
  assert.deepEqual(Object.keys(standalone).sort(), ["error", "id", "profile", "status", "viewer"], "response never exposes browser objects");
  const standaloneToken = standalone.viewer.token;
  const standaloneInternal = bridge.registry.browserSessions.get(standalone.id);
  assert.equal(bridge.registry.busyProfiles.get("workspace"), standaloneInternal);
  assert.equal(listBrowserProfiles().find(({ name }) => name === "workspace").busy, true);
  assert.throws(() => renameBrowserProfile("workspace", "renamed"), (error) => error.status === 409);
  assert.throws(() => deleteBrowserProfile("workspace"), (error) => error.status === 409);
  await assert.rejects(() => startWebLogin(provider, "workspace"), (error) => error.status === 409, "standalone and provider login share profile locks");
  await assert.rejects(() => startBrowserSession("workspace", `${origin}/`), (error) => error.status === 409);
  viewer = await connect(standaloneToken);
  const workspacePage = await until(() => standaloneInternal.context?.pages().find((page) => page.url() === `${origin}/`), "standalone launch");
  await until(() => viewer.messages.some((message) => message.type === "frame"), "standalone frame");
  await workspacePage.evaluate(() => localStorage.setItem("workspace-persisted", "yes"));
  // Setting the provider's actual credential must not auto-harvest or stop an independent browser.
  await standaloneInternal.context.addCookies([{ name: "remote_session", value: "workspace-only", url: origin }]);
  await delay(1700);
  assert.equal(getBrowserSession(standalone.id).status, "running");
  assert.equal(standaloneInternal.credential, undefined);
  viewer.send({ type: "navigate", url: `${origin}/second` });
  await until(() => workspacePage.url() === `${origin}/second`, "standalone address navigation");
  viewer.send({ type: "back" });
  await until(() => workspacePage.url() === `${origin}/`, "standalone back control");
  await click(viewer, 70, 115);
  const standalonePopup = await until(() => viewer.pages()?.pages.find((page) => page.url === `${origin}/popup`), "standalone popup");
  assert.equal(viewer.pages().activePageId, standalonePopup.id);
  await delay(150);
  await click(viewer, 80, 50);
  viewer.send({ type: "text", text: "standalone-popup" });
  const workspacePopupPage = standaloneInternal.context.pages().find((page) => page.url() === `${origin}/popup`);
  await until(() => workspacePopupPage.inputValue("#entry").then((value) => value === "standalone-popup"), "standalone popup remains controllable");
  for (const url of ["javascript:window.injected=true", "file:///etc/passwd", "data:text/html,injected", "http://user:password@localhost/"]) {
    const invalidNavigationClosed = once(viewer.ws, "close");
    viewer.send({ type: "navigate", url });
    assert.equal((await invalidNavigationClosed)[0], 1008, "invalid standalone navigation closes only the viewer");
    assert.equal(workspacePopupPage.url(), `${origin}/popup`);
    assert.equal(getBrowserSession(standalone.id).status, "running");
    viewer = await connect(standaloneToken);
  }
  const disconnected = once(viewer.ws, "close");
  viewer.ws.close();
  await disconnected;
  assert.equal(listBrowserSessions().find(({ id }) => id === standalone.id).viewer.token, standaloneToken, "disconnected workspace remains discoverable and resumable");
  viewer = await connect(getBrowserSession(standalone.id).viewer.token);
  await until(() => viewer.pages()?.pages.length === 2, "resumed standalone page list");
  const stopped = once(viewer.ws, "close");
  assert.equal(closeBrowserSession(standalone.id), true);
  assert.equal(getBrowserSession(standalone.id).viewer, null);
  assert.equal(closeBrowserSession(standalone.id), false);
  assert.equal(bridge.registry.busyProfiles.get("workspace"), standaloneInternal, "stop retains profile lock until context close completes");
  await stopped;
  await rejected(standaloneToken, origin);
  await until(() => !bridge.registry.busyProfiles.has("workspace"), "standalone stop closes context before releasing profile");
  standalone = await startBrowserSession("workspace", `${origin}/`);
  const reopened = bridge.registry.browserSessions.get(standalone.id);
  const reopenedPage = await until(() => reopened.context?.pages().find((page) => page.url() === `${origin}/`), "persistent workspace relaunch");
  await until(() => reopenedPage.evaluate(() => localStorage.getItem("workspace-persisted") === "yes"), "browser localStorage persists across launches");
  closeBrowserSession(standalone.id);
  await until(() => !bridge.registry.busyProfiles.has("workspace"), "reopened workspace cleanup");
  renameBrowserProfile("workspace", "persisted-final");
  assert.equal(await readFile(path.join(profileRoot, "persisted-final", "marker"), "utf8"), "saved-profile");
  deleteBrowserProfile("persisted-final");
  assert.ok(!listBrowserProfiles().some(({ name }) => name === "persisted-final"));

  createBrowserProfile("standalone-pending");
  const standaloneLaunchStarted = new Promise((resolve, reject) => {
    const watcher = watch(path.join(profileRoot, "standalone-pending"), (_event, name) => {
      if (!String(name).startsWith("Singleton")) return;
      clearTimeout(timer);
      watcher.close();
      resolve();
    });
    const timer = setTimeout(() => { watcher.close(); reject(new Error("Standalone launch never acquired Chromium profile")); }, 30000);
  });
  standalone = await startBrowserSession("standalone-pending", `${origin}/`);
  const pendingStandalone = bridge.registry.browserSessions.get(standalone.id);
  const pendingStandaloneToken = standalone.viewer.token;
  await standaloneLaunchStarted;
  assert.equal(pendingStandalone.context, null, "standalone cancel occurs during actual pending Chromium launch");
  closeBrowserSession(standalone.id);
  assert.equal(bridge.registry.busyProfiles.get(standalone.profile), pendingStandalone);
  assert.throws(() => deleteBrowserProfile(standalone.profile), (error) => error.status === 409);
  await rejected(pendingStandaloneToken, origin);
  await until(() => !bridge.registry.busyProfiles.has(standalone.profile), "late standalone launch closes before profile release");
  assert.equal(pendingStandalone.context, null);
  deleteBrowserProfile(standalone.profile);

  standalone = await startBrowserSession("default", `${origin}/`);
  const timedStandalone = bridge.registry.browserSessions.get(standalone.id);
  const timedToken = standalone.viewer.token;
  await until(() => timedStandalone.context?.pages().find((page) => page.url() === `${origin}/`), "timeout browser launch");
  assert.equal(timedStandalone.timer._idleTimeout, 30 * 60 * 1000, "standalone lifetime is fixed at 30 minutes");
  timedStandalone.timer._onTimeout();
  assert.equal(getBrowserSession(standalone.id).status, "timeout");
  assert.equal(getBrowserSession(standalone.id).viewer, null);
  assert.equal(bridge.registry.busyProfiles.get("default"), timedStandalone, "timeout retains profile lock until browser closes");
  await rejected(timedToken, origin);
  await until(() => !bridge.registry.busyProfiles.has("default"), "timed out standalone browser closes");
  const savedRoot = path.join(dataDir, "saved-profiles");
  await rename(profileRoot, savedRoot);
  await symlink(outside, profileRoot);
  try {
    assert.throws(() => listBrowserProfiles(), (error) => error.status === 409, "symlink profile root is never followed");
    assert.throws(() => createBrowserProfile("escaped"), (error) => error.status === 409);
  } finally {
    await rm(profileRoot);
    await rename(savedRoot, profileRoot);
  }
  console.log("web-login-remote: Chromium controls, capture, profile CRUD/persistence, standalone navigation/resume/stop, and origin/token policy passed");
} finally {
  cancelWebLogin(provider);
  if (standalone) closeBrowserSession(standalone.id);
  for (const ws of sockets) ws.terminate();
  for (const response of stalled) response.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (session) await until(() => !bridge.registry.busyProfiles.has(session.profile), "final browser cleanup").catch(() => {});
  if (standalone) await until(() => !bridge.registry.busyProfiles.has(standalone.profile), "final workspace cleanup").catch(() => {});
  stopVirtualDisplay();
  delete WEB_LOGIN_CONFIGS[provider];
  await rm(dataDir, { recursive: true, force: true });
}

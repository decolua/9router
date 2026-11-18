const { randomBytes } = require("node:crypto");
const { WebSocketServer } = require("ws");

const WIDTH = 1280;
const HEIGHT = 800;
const registryKey = Symbol.for("9router.web-login");
const registry = globalThis[registryKey] ||= { sessions: new Map(), busyProfiles: new Map(), tokens: new Map() };
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });

function isSameOrigin(origin, host) {
  if (typeof origin !== "string" || typeof host !== "string" || !host || /[\s,/@\\]/.test(host)) return false;
  try {
    const parsed = new URL(origin);
    return /^(https?:)$/.test(parsed.protocol) && parsed.origin === origin && parsed.host === new URL(`${parsed.protocol}//${host}`).host;
  } catch { return false; }
}
function validNavigationUrl(url) {
  if (typeof url !== "string" || !url || url.length > 4096 || url.trim() !== url) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function send(viewer, message) {
  const ws = viewer?.ws;
  if (!ws || ws.readyState !== 1) return;
  if (ws.bufferedAmount > 2097152) return viewer.stop(1013, "Viewer too slow");
  if (message.type === "frame" && ws.bufferedAmount > 524288) return;
  const data = JSON.stringify(message);
  if (Buffer.byteLength(data) > 2097152) return;
  try { ws.send(data, (error) => { if (error) viewer.stop(); }); } catch { viewer.stop(); }
}

function reportError(viewer, error) {
  if (viewer?.session.status === "running") send(viewer, { type: "error", error });
}

function stopScreencast(viewer) {
  viewer.generation++;
  const cdp = viewer.cdp;
  viewer.cdp = null;
  if (!cdp) return;
  cdp.removeAllListeners("Page.screencastFrame");
  void cdp.detach().catch(() => {});
}

async function selectPage(remote) {
  const viewer = remote.viewer;
  if (!viewer) return;
  stopScreencast(viewer);
  const generation = viewer.generation;
  const page = remote.pages.get(remote.activePageId)?.page;
  if (!page || page.isClosed()) return;
  let cdp;
  try {
    cdp = await remote.context.newCDPSession(page);
    if (remote.viewer !== viewer || viewer.generation !== generation || remote.disposed) {
      await cdp.detach().catch(() => {});
      return;
    }
    viewer.cdp = cdp;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      // Acknowledge even dropped frames: CDP otherwise stops producing images.
      void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (viewer.cdp === cdp) send(viewer, { type: "frame", data, width: WIDTH, height: HEIGHT });
    });
    await page.bringToFront();
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  } catch {
    const current = viewer.cdp === cdp && viewer.generation === generation;
    if (current) stopScreencast(viewer);
    if (remote.viewer === viewer && current) reportError(viewer, "Could not display this browser tab");
  }
}

function sendPages(remote) {
  if (!remote.viewer || remote.disposed) return;
  send(remote.viewer, {
    type: "pages",
    pages: Array.from(remote.pages, ([id, entry]) => ({ id, title: entry.title, url: entry.page.url().slice(0, 4096) })),
    activePageId: remote.activePageId,
  });
}

function registerSession(session) {
  session.viewerToken = randomBytes(32).toString("base64url");
  session.remote = { context: null, pages: new Map(), activePageId: null, nextPageId: 0, viewer: null, disposed: false, disposers: [], allowNavigation: session.kind === "standalone" };
  registry.tokens.set(session.viewerToken, session);
}

function attachContext(session, context) {
  const remote = session.remote;
  if (remote.disposed) return;
  remote.context = context;
  const addPage = (page) => {
    if (remote.disposed || page.isClosed()) return;
    const id = String(++remote.nextPageId);
    const entry = { page, title: "" };
    remote.pages.set(id, entry);
    const refresh = () => {
      if (remote.disposed) return;
      sendPages(remote);
      void page.title().then((title) => {
        if (!remote.disposed && remote.pages.has(id) && title !== entry.title) {
          entry.title = title.slice(0, 256);
          sendPages(remote);
        }
      }).catch(() => {});
    };
    const close = () => {
      page.off("domcontentloaded", refresh);
      page.off("framenavigated", refresh);
      remote.pages.delete(id);
      if (remote.activePageId === id) {
        remote.activePageId = Array.from(remote.pages.keys()).at(-1) || null;
        void selectPage(remote);
      }
      sendPages(remote);
    };
    page.on("domcontentloaded", refresh);
    page.on("framenavigated", refresh);
    page.once("close", close);
    remote.disposers.push(() => {
      page.off("domcontentloaded", refresh);
      page.off("framenavigated", refresh);
      page.off("close", close);
    });
    remote.activePageId = id;
    refresh();
    void selectPage(remote);
  };
  context.on("page", addPage);
  remote.disposers.push(() => context.off("page", addPage));
  for (const page of context.pages()) addPage(page);
}

function revokeSession(session) {
  registry.tokens.delete(session.viewerToken);
  session.viewerToken = null;
  const remote = session.remote;
  if (!remote || remote.disposed) return;
  remote.disposed = true;
  remote.viewer?.stop(1000, "Browser session finished");
  for (const dispose of remote.disposers) dispose();
  remote.disposers = [];
  remote.pages.clear();
  remote.context = null;
}

function validInput(message, remote) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const fields = {
    mouse: ["type", "event", "x", "y", "button", "clickCount", "modifiers"],
    wheel: ["type", "x", "y", "deltaX", "deltaY", "modifiers"],
    key: ["type", "event", "key", "code", "modifiers", "windowsVirtualKeyCode"],
    text: ["type", "text"], page: ["type", "id"], back: ["type"], reload: ["type"],
    navigate: ["type", "url"],
  }[message.type];
  if (!Array.isArray(fields) || fields.length !== Object.keys(message).length || Object.keys(message).some((key) => !fields.includes(key))) return false;
  const number = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  if (["mouse", "wheel"].includes(message.type) && (!number(message.x, 0, WIDTH - 1) || !number(message.y, 0, HEIGHT - 1))) return false;
  if (["mouse", "wheel", "key"].includes(message.type) && (!Number.isInteger(message.modifiers) || !number(message.modifiers, 0, 15))) return false;
  switch (message.type) {
    case "mouse": return ["mouseMoved", "mousePressed", "mouseReleased"].includes(message.event) && ["none", "left", "middle", "right"].includes(message.button) && (message.event === "mouseMoved" || message.button !== "none") && [1, 2].includes(message.clickCount);
    case "wheel": return number(message.deltaX, -10000, 10000) && number(message.deltaY, -10000, 10000);
    case "key": return ["keyDown", "keyUp"].includes(message.event) && typeof message.key === "string" && message.key.length <= 64 && typeof message.code === "string" && message.code.length <= 64 && Number.isInteger(message.windowsVirtualKeyCode) && number(message.windowsVirtualKeyCode, 0, 255);
    case "text": return typeof message.text === "string" && message.text.length > 0 && Buffer.byteLength(message.text) <= 8192;
    case "page": return typeof message.id === "string" && remote.pages.has(message.id);
    case "navigate": return remote.allowNavigation && validNavigationUrl(message.url);
    default: return true;
  }
}

async function dispatchInput(viewer, message) {
  const remote = viewer.session.remote;
  if (remote.viewer !== viewer || remote.disposed) return;
  if (message.type === "page") {
    remote.activePageId = message.id;
    sendPages(remote);
    await selectPage(remote);
    return;
  }
  const page = remote.pages.get(remote.activePageId)?.page;
  const cdp = viewer.cdp;
  if (!page || !cdp || page.isClosed()) return;
  switch (message.type) {
    case "navigate": await page.goto(message.url, { waitUntil: "domcontentloaded", timeout: 10000 }); break;
    case "mouse":
      await cdp.send("Input.dispatchMouseEvent", { type: message.event, x: message.x, y: message.y, button: message.button, clickCount: message.clickCount, modifiers: message.modifiers });
      break;
    case "wheel":
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: message.x, y: message.y, deltaX: message.deltaX, deltaY: message.deltaY, modifiers: message.modifiers });
      break;
    case "key":
      await cdp.send("Input.dispatchKeyEvent", { type: message.event, key: message.key, code: message.code, modifiers: message.modifiers, windowsVirtualKeyCode: message.windowsVirtualKeyCode, ...(message.event === "keyDown" && message.key === "Enter" ? { text: "\r" } : {}) });
      break;
    case "text": await cdp.send("Input.insertText", { text: message.text }); break;
    case "back": await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }); break;
    case "reload": await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 }); break;
  }
}

function connectViewer(session, ws) {
  const remote = session.remote;
  remote.viewer?.stop(1000, "Viewer replaced");
  const viewer = { session, ws, cdp: null, generation: 0, pending: 0, queue: Promise.resolve(), stopped: false, received: 0, windowStart: Date.now() };
  viewer.stop = (code = 1000, reason = "Viewer disconnected") => {
    if (viewer.stopped) return;
    viewer.stopped = true;
    stopScreencast(viewer);
    if (remote.viewer === viewer) remote.viewer = null;
    if (ws.readyState < 2) {
      ws.close(code, reason);
      const timer = setTimeout(() => ws.terminate(), 1000);
      timer.unref();
      ws.once("close", () => clearTimeout(timer));
    }
  };
  ws.on("error", () => viewer.stop());
  ws.once("close", () => viewer.stop());
  if (session.status !== "running" || remote.disposed) return viewer.stop(1008, "Login not active");
  remote.viewer = viewer;
  ws.on("message", (data, binary) => {
    if (viewer.stopped || remote.viewer !== viewer) return;
    if (Date.now() - viewer.windowStart >= 1000) { viewer.received = 0; viewer.windowStart = Date.now(); }
    if (binary || ++viewer.received > 240 || viewer.pending >= 64) return viewer.stop(1008, "Invalid viewer input");
    let message;
    try { message = JSON.parse(data.toString()); } catch { return viewer.stop(1008, "Invalid viewer input"); }
    if (!validInput(message, remote)) return viewer.stop(1008, "Invalid viewer input");
    viewer.pending++;
    viewer.queue = viewer.queue.then(() => dispatchInput(viewer, message)).catch(() => {
      if (remote.viewer === viewer) reportError(viewer, "Browser input failed; select a tab or reconnect");
    }).finally(() => { viewer.pending--; });
  });
  sendPages(remote);
  void selectPage(remote);
}

// Synchronous claim: the custom server must not pass this upgrade to Next or another bridge.
function webLoginWebSocket(_server, req, socket, head) {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return false; }
  if (url.pathname !== "/api/providers/web-login/view") return false;
  const reject = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  const token = url.searchParams.get("token");
  if (!isSameOrigin(req.headers.origin, req.headers.host)) { reject("403 Forbidden"); return true; }
  const session = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && url.searchParams.getAll("token").length === 1 ? registry.tokens.get(token) : null;
  if (!session || session.status !== "running") { reject("403 Forbidden"); return true; }
  if (req.method !== "GET" || !/\bupgrade\b/i.test(req.headers.connection || "") || req.headers["sec-websocket-version"] !== "13" || !/^[+/0-9A-Za-z]{22}==$/.test(req.headers["sec-websocket-key"] || "")) { reject("400 Bad Request"); return true; }
  websocketServer.handleUpgrade(req, socket, head, (ws) => connectViewer(session, ws));
  return true;
}

module.exports = webLoginWebSocket;
module.exports.registry = registry;
module.exports.isSameOrigin = isSameOrigin;
module.exports.validNavigationUrl = validNavigationUrl;
module.exports.registerSession = registerSession;
module.exports.attachContext = attachContext;
module.exports.revokeSession = revokeSession;

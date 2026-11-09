import { NextResponse } from "next/server";
import net from "node:net";
import { createProxyPool, getProxyPools } from "@/models";

export const dynamic = "force-dynamic";

// Verified and active fresh proxy feeds (sorted by speed & working ratio)
const HARVEST_FEEDS = [
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
];

const CONCURRENCY_LIMIT = 50;
const PROBE_TIMEOUT_MS = 2500;
const TCP_PRECHECK_TIMEOUT_MS = 800;

/**
 * Super-fast TCP handshake pre-check: filters out dead/offline IPs in <1s
 * using raw OS sockets, without paying Undici/HTTP connection setup overhead.
 */
function tcpPrecheck(hostPort, timeoutMs = TCP_PRECHECK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const [host, portStr] = hostPort.split(":");
    const port = Number(portStr);
    if (!host || !port) return resolve(false);

    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(true);
      }
    });

    socket.on("timeout", () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.on("error", () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    try {
      socket.connect(port, host);
    } catch {
      resolve(false);
    }
  });
}

async function probeProxy(hostPort, timeoutMs = PROBE_TIMEOUT_MS) {
  let dispatcher;
  try {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent({ uri: `http://${hostPort}` });
    const startedAt = Date.now();
    const res = await fetch("https://1.1.1.1/cdn-cgi/trace", {
      dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "9Router" },
    });
    if (!res.ok) return { ok: false };
    const text = await res.text();
    const fields = {};
    for (const line of text.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return {
      ok: true,
      egressIp: fields.ip || null,
      loc: fields.loc || null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch {
    return { ok: false };
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {}
  }
}

// In-memory state for background harvester worker
if (!global._nineHarvesterState) {
  global._nineHarvesterState = {
    running: false,
    loopIntervalMinutes: 0,
    targetCount: 5,
    timer: null,
    lastRunAt: null,
    lastAdded: 0,
    lastTested: 0,
    lastMessage: "Idle",
    history: [],
  };
}

const state = global._nineHarvesterState;

async function fetchCandidates(target = 50) {
  const candidates = new Set();
  const candidateLimit = Math.max(500, target * 15);

  // Fetch all feeds in parallel with strict 4s timeout for maximum speed
  await Promise.allSettled(
    HARVEST_FEEDS.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return;
        const text = await res.text();
        const lines = text.split("\n");
        for (const line of lines) {
          let clean = line.trim();
          if (!clean || clean.startsWith("#")) continue;
          // Strip protocol prefixes if present (e.g. http:// or socks5://)
          clean = clean.replace(/^(?:https?|socks[45]):\/\//i, "").trim();
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$/.test(clean)) {
            candidates.add(clean);
          }
        }
      } catch {}
    })
  );

  return Array.from(candidates).sort(() => Math.random() - 0.5).slice(0, candidateLimit);
}

async function runWithConcurrency(items, limit, fn, shouldStop) {
  for (let i = 0; i < items.length; i += limit) {
    if (shouldStop && shouldStop()) break;
    const chunk = items.slice(i, i + limit);
    await Promise.all(chunk.map((item) => fn(item)));
    if (shouldStop && shouldStop()) break;
  }
}

async function executeHarvestCycle(target = 5) {
  if (state._inCycle) return;
  state._inCycle = true;
  state.lastRunAt = new Date().toISOString();
  state.lastMessage = "Fetching fresh proxy candidate feeds...";

  try {
    const existingPools = await getProxyPools();
    const existingUrls = new Set(
      existingPools.map((p) => p.proxyUrl?.toLowerCase().trim())
    );
    const existingEgressIps = new Set(
      existingPools.map((p) => p.egressIp?.toLowerCase().trim()).filter(Boolean)
    );

    const candidates = await fetchCandidates(target);
    const unadded = candidates.filter(
      (c) => !existingUrls.has(`http://${c}`) && !existingUrls.has(`https://${c}`)
    );
    state.lastMessage = `Scanning ${unadded.length} candidate proxies (found ${candidates.length} total)...`;

    let addedCount = 0;
    let scannedCount = 0;
    const liveProxies = [];

    await runWithConcurrency(
      unadded,
      CONCURRENCY_LIMIT,
      async (hostPort) => {
        if (!state.running && state.loopIntervalMinutes === 0) return;
        if (addedCount >= target) return;

        // Stage 1: Ultra-fast TCP socket ping (<1s). Skip dead IPs immediately!
        const tcpAlive = await tcpPrecheck(hostPort);
        if (!tcpAlive) {
          scannedCount += 1;
          if (scannedCount % 25 === 0) {
            state.lastMessage = `Scanning: ${scannedCount}/${unadded.length} tested (${addedCount}/${target} live proxies imported)...`;
          }
          return;
        }

        // Stage 2: Full HTTP(S) proxy verification through Cloudflare trace
        const proxyUrl = `http://${hostPort}`;
        try {
          const result = await probeProxy(hostPort);

          if (result?.ok && addedCount < target) {
            const egressIp = result.egressIp ? String(result.egressIp).toLowerCase().trim() : null;
            if (egressIp && existingEgressIps.has(egressIp)) {
              // Egress IP collision: drop duplicate so quota buckets are distinct
              return;
            }
            if (egressIp) existingEgressIps.add(egressIp);

            const locSuffix = result.loc ? `-[${result.loc}]` : "";
            const name = `FreeProxy-${hostPort.replace(":", "_")}${locSuffix}`;
            await createProxyPool({
              name,
              proxyUrl,
              type: "http",
              isActive: true,
              strictProxy: false,
              noProxy: "",
              egressIp: egressIp || null,
              loc: result.loc || null,
              testStatus: "working",
              lastTestedAt: new Date().toISOString(),
            });
            addedCount += 1;
            liveProxies.push({ hostPort, latencyMs: result.elapsedMs, egressIp, loc: result.loc });
          }
        } catch {
          // Drop dead proxy silently
        } finally {
          scannedCount += 1;
          if (scannedCount % 25 === 0 || addedCount > 0) {
            state.lastAdded = addedCount;
            state.lastMessage = `Scanning: ${scannedCount}/${unadded.length} tested (${addedCount}/${target} live proxies imported)...`;
          }
        }
      },
      () => addedCount >= target || (!state.running && state.loopIntervalMinutes === 0)
    );

    state.lastAdded = addedCount;
    state.lastTested = unadded.length;
    state.lastMessage = `Finished: Added ${addedCount} live proxies (tested ${unadded.length}).`;
    state.history = [
      {
        at: new Date().toISOString(),
        added: addedCount,
        tested: unadded.length,
        proxies: liveProxies.slice(0, 10),
      },
      ...(state.history || []),
    ].slice(0, 10);
  } catch (err) {
    state.lastMessage = `Cycle failed: ${err.message}`;
  } finally {
    state._inCycle = false;
    // If not looping, set running to false when complete
    if (state.loopIntervalMinutes === 0) {
      state.running = false;
    }
  }
}

function scheduleNextLoop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.running && state.loopIntervalMinutes > 0) {
    const ms = state.loopIntervalMinutes * 60 * 1000;
    state.timer = setInterval(() => {
      if (state.running) {
        executeHarvestCycle(state.targetCount);
      }
    }, ms);
  }
}

/**
 * GET /api/harvester
 * Get current harvester daemon status
 */
export async function GET() {
  return NextResponse.json({
    running: state.running,
    targetCount: state.targetCount,
    loopIntervalMinutes: state.loopIntervalMinutes,
    lastRunAt: state.lastRunAt,
    lastAdded: state.lastAdded,
    lastTested: state.lastTested,
    lastMessage: state.lastMessage,
    history: state.history || [],
  });
}

/**
 * POST /api/harvester
 * Start, configure, or stop the background harvester worker
 */
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { action, target = 5, loopMinutes = 0 } = body;

    if (action === "stop") {
      state.running = false;
      state.loopIntervalMinutes = 0;
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      state.lastMessage = "Harvester stopped by user.";
      return NextResponse.json({ success: true, running: false, message: state.lastMessage });
    }

    // Configure and start
    const numericTarget = Math.max(1, Math.min(Number(target) || 5, 200));
    const numericLoop = Number(loopMinutes) >= 0 ? Number(loopMinutes) : 0;

    state.targetCount = numericTarget;
    state.loopIntervalMinutes = numericLoop;
    state.running = true;

    scheduleNextLoop();

    // Trigger cycle in background asynchronously without blocking HTTP response
    executeHarvestCycle(numericTarget);

    return NextResponse.json({
      success: true,
      running: true,
      targetCount: numericTarget,
      loopIntervalMinutes: numericLoop,
      message: `Harvester started: Target ${numericTarget} proxies${numericLoop > 0 ? `, looping every ${numericLoop}m` : ""}. Running in background.`,
    });
  } catch (error) {
    console.error("Proxy harvest error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to control proxy harvester" },
      { status: 500 }
    );
  }
}

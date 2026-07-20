import { NextResponse } from "next/server";
import { FiveSimClient } from "@/lib/oauth/services/fiveSimClient";
import {
  resolveBulkImportProxy,
  splitBulkImportProxyUrls,
} from "@/lib/oauth/services/bulkImportProxyResolver";
import { getBrowserProxyPools } from "@/lib/oauth/services/bulkImportProxyOptions";
import { getProxyPools } from "@/models";

export const dynamic = "force-dynamic";

const MAX_QUOTE_ATTEMPTS = 8;
const FETCH_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

function parseRequestedCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(8, Math.max(1, parsed));
}

function isTransientFiveSimError(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status === 444 || status >= 500;
}

function normalizeProxyUrl(value) {
  return String(value || "").trim();
}

function canFetchThroughProxy(proxyUrl) {
  const clean = normalizeProxyUrl(proxyUrl);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    return FETCH_PROXY_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function pushAttempt(attempts, seen, attempt) {
  const proxyUrl = normalizeProxyUrl(attempt.proxyUrl);
  const key = proxyUrl || "direct";
  if (seen.has(key)) return;
  seen.add(key);
  attempts.push({ ...attempt, proxyUrl: proxyUrl || null });
}

async function getActivePoolAttempts(seen) {
  try {
    const pools = getBrowserProxyPools({ proxyPools: await getProxyPools({ isActive: true }) })
      .filter((pool) => pool.browserCompatible !== false);
    const attempts = [];
    pools.forEach((pool) => {
      splitBulkImportProxyUrls(pool.proxyUrl)
        .filter(canFetchThroughProxy)
        .forEach((proxyUrl, index) => {
          const key = normalizeProxyUrl(proxyUrl);
          if (seen.has(key)) return;
          attempts.push({
            proxyUrl,
            proxyMode: "auto-pool",
            proxyPoolId: pool.id || null,
            proxySource: "auto-pool",
            proxyCount: splitBulkImportProxyUrls(pool.proxyUrl).length,
            proxyRoute: `auto proxy pool ${pool.name || pool.id || "proxy"} #${index + 1}`,
          });
        });
    });
    return attempts;
  } catch {
    return [];
  }
}

async function buildQuoteAttempts(resolvedProxy, body) {
  const attempts = [];
  const seen = new Set();
  const explicitProxyRequested = Boolean(body?.proxyPoolId || body?.proxyUrl);
  const resolvedUrls = Array.isArray(resolvedProxy.proxyUrls) ? resolvedProxy.proxyUrls : [];

  if (!explicitProxyRequested && !resolvedUrls.length) {
    pushAttempt(attempts, seen, {
      proxyUrl: null,
      proxyMode: "none",
      proxyPoolId: null,
      proxySource: null,
      proxyCount: 0,
      proxyRoute: "direct",
    });
  }

  resolvedUrls
    .filter((proxyUrl) => !proxyUrl || canFetchThroughProxy(proxyUrl))
    .forEach((proxyUrl, index) => {
      pushAttempt(attempts, seen, {
        proxyUrl,
        proxyMode: resolvedProxy.proxyMode,
        proxyPoolId: resolvedProxy.proxyPoolId,
        proxySource: resolvedProxy.proxySource,
        proxyCount: resolvedUrls.length,
        proxyRoute: resolvedProxy.proxySource === "pool"
          ? `selected proxy pool #${index + 1}`
          : (proxyUrl ? `selected proxy #${index + 1}` : "direct"),
      });
    });

  const autoAttempts = await getActivePoolAttempts(seen);
  autoAttempts.forEach((attempt) => pushAttempt(attempts, seen, attempt));

  pushAttempt(attempts, seen, {
    proxyUrl: null,
    proxyMode: "none",
    proxyPoolId: null,
    proxySource: null,
    proxyCount: 0,
    proxyRoute: "direct",
  });

  if (!attempts.length) {
    pushAttempt(attempts, seen, {
      proxyUrl: null,
      proxyMode: "none",
      proxyPoolId: null,
      proxySource: null,
      proxyCount: 0,
      proxyRoute: "direct",
    });
  }

  return attempts.slice(0, MAX_QUOTE_ATTEMPTS);
}

async function getQuoteWithFallback({
  token,
  body,
  resolvedProxy,
  fiveSimClientFactory = (options) => new FiveSimClient(options),
}) {
  const attempts = await buildQuoteAttempts(resolvedProxy, body);
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const client = fiveSimClientFactory({ token, proxyUrl: attempt.proxyUrl });
      const quote = await client.getActivationQuote({
        country: body?.country,
        operator: body?.operator,
        product: body?.product,
      });
      return {
        quote,
        route: {
          ...attempt,
          attemptedRoutes: index + 1,
          fallbackUsed: index > 0,
          totalRoutes: attempts.length,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isTransientFiveSimError(error)) throw error;
    }
  }
  const error = new Error(`5sim check failed after ${attempts.length} route${attempts.length === 1 ? "" : "s"}: ${lastError?.message || "unknown error"}`);
  error.status = lastError?.status;
  throw error;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body?.fiveSimToken || "").trim();
    if (!token) {
      return NextResponse.json({ error: "5sim API token is required" }, { status: 400 });
    }

    const resolvedProxy = await resolveBulkImportProxy({
      proxyPoolId: body?.proxyPoolId,
      proxyUrl: body?.proxyUrl,
    });
    const { error: proxyError } = resolvedProxy;
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const requestedCount = parseRequestedCount(body?.count);
    const { quote, route } = await getQuoteWithFallback({ token, body, resolvedProxy });

    return NextResponse.json({
      success: true,
      quote: {
        ...quote,
        requestedCount,
        canAffordRequested: quote.capacity >= requestedCount,
        shortage: Math.max(0, requestedCount - quote.capacity),
        proxyMode: route.proxyMode,
        proxyPoolId: route.proxyPoolId,
        proxySource: route.proxySource,
        proxyCount: route.proxyCount,
        proxyRoute: route.proxyRoute,
        quoteFallbackUsed: route.fallbackUsed,
        quoteAttemptedRoutes: route.attemptedRoutes,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to check 5sim balance" },
      { status: 400 }
    );
  }
}

export const __test__ = {
  buildQuoteAttempts,
  getQuoteWithFallback,
  isTransientFiveSimError,
};

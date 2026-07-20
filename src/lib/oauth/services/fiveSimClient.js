import { ProxyAgent } from "undici";

const FIVE_SIM_API_BASE = "https://5sim.net/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_OTP_TIMEOUT_MS = 120_000;
const PRICE_CACHE_TTL_MS = 30_000;
const PRICE_CACHE_STALE_TTL_MS = 5 * 60_000;
const GUEST_RETRY_DELAYS_MS = [250, 750];
const PROFILE_RETRY_DELAYS_MS = [250, 750, 1500];
const DEFAULT_CHECK_RETRY_COUNT = 5;
const CHECK_RETRY_DELAY_MS = 1_000;
const FETCH_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);
const priceCacheByFetch = new WeakMap();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOtpCode(payload) {
  const sms = Array.isArray(payload?.sms) ? payload.sms : [];
  for (const item of sms) {
    if (item?.code) return String(item.code).trim();
    const text = String(item?.text || "");
    const match = text.match(/\b(\d{4,8})\b/);
    if (match) return match[1];
  }
  return "";
}

function normalizeOrder(payload) {
  return {
    ...payload,
    code: extractOtpCode(payload),
  };
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const clean = String(value || "").trim().toLowerCase();
    if (clean) searchParams.set(key, clean);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function listAvailableOffers(prices, country, product) {
  const countryPrices = prices?.[country] || {};
  const productPrices = countryPrices?.[product] || {};
  return Object.entries(productPrices)
    .filter(([, meta]) => Number(meta?.count || 0) > 0)
    .map(([operator, meta]) => ({
      operator,
      cost: Number(meta?.cost ?? Number.POSITIVE_INFINITY),
      count: Number(meta?.count || 0),
    }))
    .sort((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost;
      return right.count - left.count;
    });
}

function buildNoStockMessage(country, product, operator) {
  const scope = operator && operator !== "any" ? `${operator} operator` : "any operator";
  return `No available 5sim phone numbers for ${product} in ${country} using ${scope}`;
}

function assertBalanceCoversOffer(profile, offer, country, product) {
  const balance = Number(profile?.balance ?? 0);
  if (!Number.isFinite(offer.cost) || balance >= offer.cost) return;
  throw new Error(`5sim balance ${balance} is lower than ${offer.cost} required for ${product} in ${country} (${offer.operator})`);
}

function assertPositiveBalance(profile) {
  const balance = Number(profile?.balance ?? 0);
  if (Number.isFinite(balance) && balance > 0) return;
  throw new Error(`5sim balance ${balance} is not enough to buy a phone number`);
}

function isTransientRequestError(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status === 444 || status >= 500;
}

function getPriceCache(fetchImpl) {
  let cache = priceCacheByFetch.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    priceCacheByFetch.set(fetchImpl, cache);
  }
  return cache;
}

function normalizeProxyUrl(proxyUrl) {
  return String(proxyUrl || "").trim();
}

function createFetchDispatcher(proxyUrl) {
  const clean = normalizeProxyUrl(proxyUrl);
  if (!clean) return null;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return null;
  }
  if (!FETCH_PROXY_PROTOCOLS.has(parsed.protocol)) return null;
  try {
    return new ProxyAgent(clean);
  } catch {
    return null;
  }
}

function isRetryableBuyError(error) {
  const status = Number(error?.status || 0);
  return (status >= 500 && status < 600)
    || /bad gateway|no free phones|not enough phones|not available/i.test(error?.message || "");
}

export class FiveSimClient {
  constructor({ token, fetchImpl = fetch, baseUrl = FIVE_SIM_API_BASE, waitImpl = wait, proxyUrl } = {}) {
    this.token = String(token || "").trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || FIVE_SIM_API_BASE).replace(/\/$/, "");
    this.wait = waitImpl;
    this.proxyUrl = normalizeProxyUrl(proxyUrl);
    this.fetchDispatcher = createFetchDispatcher(this.proxyUrl);
    this.priceCachePrefix = this.proxyUrl || "direct";
    this.priceCache = getPriceCache(fetchImpl);
  }

  async fetchJson(path, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init = {
        method: "GET",
        headers,
        signal: controller.signal,
      };
      if (this.fetchDispatcher) init.dispatcher = this.fetchDispatcher;
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      const text = await response.text?.() ?? "";
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : await response.json();
      } catch {
        payload = { message: text };
      }
      if (!response.ok) {
        const msg = payload?.message || payload?.error || text || `5sim HTTP ${response.status}`;
        const error = new Error(`5sim HTTP ${response.status} for ${path}: ${msg}`);
        error.status = response.status;
        error.path = path;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async request(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.token) {
      throw new Error("5sim token is required");
    }
    return this.fetchJson(path, {
      timeoutMs,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
  }

  async guestRequest(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return this.fetchJson(path, {
      timeoutMs,
      headers: {
        Accept: "application/json",
      },
    });
  }

  async getProfile() {
    let lastError = null;
    for (let attempt = 0; attempt <= PROFILE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.request("/user/profile");
      } catch (error) {
        lastError = error;
        if (!isTransientRequestError(error) || attempt === PROFILE_RETRY_DELAYS_MS.length) break;
        await this.wait(PROFILE_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async getPrices({ country, product } = {}) {
    const path = `/guest/prices${buildQuery({ country, product })}`;
    const cacheKey = `${this.priceCachePrefix}:${path}`;
    const now = Date.now();
    const cached = this.priceCache.get(cacheKey);
    if (cached?.payload && cached.expiresAt > now) return cached.payload;
    if (cached?.inFlight) return cached.inFlight;

    const inFlight = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= GUEST_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const payload = await this.guestRequest(path);
          this.priceCache.set(cacheKey, {
            payload,
            expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
            staleUntil: Date.now() + PRICE_CACHE_STALE_TTL_MS,
            inFlight: null,
          });
          return payload;
        } catch (error) {
          lastError = error;
          if (!isTransientRequestError(error) || attempt === GUEST_RETRY_DELAYS_MS.length) break;
          await this.wait(GUEST_RETRY_DELAYS_MS[attempt]);
        }
      }

      if (cached?.payload && cached.staleUntil > Date.now()) return cached.payload;
      throw lastError;
    })();

    this.priceCache.set(cacheKey, { ...cached, inFlight });
    try {
      return await inFlight;
    } finally {
      const current = this.priceCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        if (current.payload) this.priceCache.set(cacheKey, { ...current, inFlight: null });
        else this.priceCache.delete(cacheKey);
      }
    }
  }

  async buyActivation({ country = "hongkong", operator = "any", product = "codebuddy" } = {}) {
    const normalizedCountry = String(country || "hongkong").trim().toLowerCase();
    const normalizedProduct = String(product || "codebuddy").trim().toLowerCase();
    const cleanCountry = encodeURIComponent(normalizedCountry);
    const cleanProduct = encodeURIComponent(normalizedProduct);
    const requestedOperator = String(operator || "any").trim().toLowerCase();
    let discoveryError = null;
    let candidates;
    try {
      const prices = await this.getPrices({ country: normalizedCountry, product: normalizedProduct });
      const offers = listAvailableOffers(prices, normalizedCountry, normalizedProduct);
      candidates = requestedOperator && requestedOperator !== "any"
        ? offers.filter((offer) => offer.operator === requestedOperator)
        : offers;
    } catch (error) {
      if (!isTransientRequestError(error)) throw error;
      discoveryError = error;
      candidates = [{
        operator: requestedOperator || "any",
        cost: Number.POSITIVE_INFINITY,
        count: 0,
      }];
    }
    if (!candidates.length) {
      throw new Error(buildNoStockMessage(normalizedCountry, normalizedProduct, requestedOperator || "any"));
    }

    const profile = await this.getProfile();
    if (discoveryError) assertPositiveBalance(profile);
    else assertBalanceCoversOffer(profile, candidates[0], normalizedCountry, normalizedProduct);

    let lastError = null;
    for (const offer of candidates.slice(0, 5)) {
      try {
        const cleanOperator = encodeURIComponent(offer.operator);
        return await this.request(`/user/buy/activation/${cleanCountry}/${cleanOperator}/${cleanProduct}`);
      } catch (error) {
        lastError = error;
        if (!isRetryableBuyError(error)) throw error;
      }
    }
    if (discoveryError && lastError) {
      const error = new Error(`${discoveryError.message}; authenticated buy fallback also failed: ${lastError.message}`);
      error.status = lastError.status;
      error.path = lastError.path;
      throw error;
    }
    throw lastError || new Error(buildNoStockMessage(normalizedCountry, normalizedProduct, requestedOperator || "any"));
  }

  async getActivationQuote({ country = "hongkong", operator = "any", product = "codebuddy" } = {}) {
    const normalizedCountry = String(country || "hongkong").trim().toLowerCase();
    const normalizedProduct = String(product || "codebuddy").trim().toLowerCase();
    const requestedOperator = String(operator || "any").trim().toLowerCase();
    const [profile, prices] = await Promise.all([
      this.getProfile(),
      this.getPrices({ country: normalizedCountry, product: normalizedProduct }),
    ]);
    const offers = listAvailableOffers(prices, normalizedCountry, normalizedProduct);
    const candidates = requestedOperator && requestedOperator !== "any"
      ? offers.filter((offer) => offer.operator === requestedOperator)
      : offers;
    const selectedOffer = candidates[0] || null;
    const balance = Number(profile?.balance ?? 0);
    const unitCost = Number(selectedOffer?.cost ?? 0);
    const purchasableByBalance = unitCost > 0 ? Math.floor(balance / unitCost) : 0;
    const availableCount = Number(selectedOffer?.count || 0);
    return {
      country: normalizedCountry,
      product: normalizedProduct,
      operator: requestedOperator || "any",
      balance,
      selectedOffer,
      availableCount,
      unitCost: selectedOffer ? unitCost : null,
      purchasableByBalance: selectedOffer ? purchasableByBalance : 0,
      capacity: selectedOffer ? Math.min(availableCount, purchasableByBalance) : 0,
      noStockMessage: selectedOffer ? "" : buildNoStockMessage(normalizedCountry, normalizedProduct, requestedOperator || "any"),
    };
  }

  async checkOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return normalizeOrder(await this.request(`/user/check/${id}`));
  }

  async finishOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/finish/${id}`);
  }

  async cancelOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/cancel/${id}`);
  }

  async waitForCode(orderId, {
    timeoutMs = DEFAULT_OTP_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    checkRetryCount = DEFAULT_CHECK_RETRY_COUNT,
  } = {}) {
    const startedAt = Date.now();
    let lastOrder = null;
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      const attempts = Math.max(1, Number.parseInt(checkRetryCount, 10) || DEFAULT_CHECK_RETRY_COUNT);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          lastOrder = await this.checkOrder(orderId);
          lastError = null;
          if (lastOrder.code) return lastOrder;
          break;
        } catch (error) {
          if (!isTransientRequestError(error)) throw error;
          lastError = error;
          if (attempt < attempts && Date.now() - startedAt < timeoutMs) {
            await this.wait(CHECK_RETRY_DELAY_MS);
          }
        }
      }
      await this.wait(pollIntervalMs);
    }
    const suffix = lastError?.message ? `; last 5sim error: ${lastError.message}` : "";
    const error = new Error(`Timed out waiting for 5sim OTP code${suffix}`);
    error.order = lastOrder;
    error.lastError = lastError;
    throw error;
  }
}

export function createFiveSimClient(options) {
  return new FiveSimClient(options);
}

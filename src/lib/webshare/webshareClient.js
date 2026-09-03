const WEBSHARE_BASE_URL = "https://proxy.webshare.io/api/v2";
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export class WebshareError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "WebshareError";
    this.status = options.status ?? null;
  }
}

export class WebshareAuthError extends WebshareError {
  constructor(message = "Webshare authentication failed", options = {}) {
    super(message, options);
    this.name = "WebshareAuthError";
  }
}

export class WebshareRateLimitError extends WebshareError {
  constructor(message = "Webshare API rate limit exceeded", options = {}) {
    super(message, options);
    this.name = "WebshareRateLimitError";
  }
}

function sleep(ms, signal) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("Operation aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combineSignals(...signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();

  const abortFrom = (sourceSignal) => {
    if (controller.signal.aborted) {
      return;
    }
    controller.abort(sourceSignal.reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }

  return controller.signal;
}

function getTimeoutSignal() {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  return controller.signal;
}

function parseRetryAfterSeconds(response) {
  const header = response.headers.get("Retry-After");
  const seconds = Number.parseInt(header ?? "", 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new WebshareError("Webshare API returned invalid JSON", { status: response.status });
  }
}

function createHttpError(response) {
  if (response.status === 401 || response.status === 403) {
    return new WebshareAuthError("Webshare authentication failed", { status: response.status });
  }

  return new WebshareError(`Webshare API request failed with status ${response.status}`, {
    status: response.status,
  });
}

async function fetchWebshareJson(url, apiKey, { signal, allowRateLimitRetry = false } = {}) {
  const timeoutSignal = getTimeoutSignal();
  const requestSignal = combineSignals(signal, timeoutSignal);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token ${apiKey}`,
      },
      signal: requestSignal,
      cache: "no-store",
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new WebshareError("Webshare API request timed out", { cause: error });
    }
    throw new WebshareError("Webshare API request failed", { cause: error });
  }

  if (response.status === 429) {
    if (!allowRateLimitRetry) {
      throw new WebshareRateLimitError("Webshare API rate limit exceeded", { status: 429 });
    }

    const retryAfterSeconds = parseRetryAfterSeconds(response);
    await sleep(retryAfterSeconds * 1000, signal);

    const retryTimeoutSignal = getTimeoutSignal();
    const retrySignal = combineSignals(signal, retryTimeoutSignal);

    let retryResponse;
    try {
      retryResponse = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Token ${apiKey}`,
        },
        signal: retrySignal,
        cache: "no-store",
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new WebshareError("Webshare API request timed out", { cause: error });
      }
      throw new WebshareError("Webshare API request failed", { cause: error });
    }

    if (retryResponse.status === 429) {
      throw new WebshareRateLimitError("Webshare API rate limit exceeded after retry", { status: 429 });
    }

    if (!retryResponse.ok) {
      throw createHttpError(retryResponse);
    }

    return parseJsonResponse(retryResponse);
  }

  if (!response.ok) {
    throw createHttpError(response);
  }

  return parseJsonResponse(response);
}

function normalizeProxy(proxy) {
  const username = proxy.username ?? "";
  const password = proxy.password ?? "";
  const proxyAddress = proxy.proxy_address ?? "";
  const port = proxy.port ?? "";

  return {
    webshareId: proxy.id,
    username,
    password,
    proxyAddress,
    port,
    valid: proxy.valid,
    countryCode: proxy.country_code,
    cityName: proxy.city_name,
    createdAt: proxy.created_at,
    proxyUrl: `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${proxyAddress}:${port}`,
  };
}

export async function getProfile(apiKey) {
  return fetchWebshareJson(`${WEBSHARE_BASE_URL}/profile/`, apiKey);
}

export async function listProxiesAll(apiKey, { signal } = {}) {
  const proxies = [];
  // mode=direct required because backbone mode returns single endpoint instead of one endpoint per proxy.
  let nextUrl = `${WEBSHARE_BASE_URL}/proxy/list/?mode=direct&page=1&page_size=100`;

  while (nextUrl) {
    const page = await fetchWebshareJson(nextUrl, apiKey, {
      signal,
      allowRateLimitRetry: true,
    });

    if (!page || !Array.isArray(page.results)) {
      throw new WebshareError("Webshare proxy list response shape invalid");
    }

    proxies.push(...page.results.map(normalizeProxy));
    nextUrl = page.next;
  }

  return proxies;
}

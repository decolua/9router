const REDIS_CONNECT_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || "500", 10) || 0,
  100
);

const REDIS_RETRY_COOLDOWN_MS = Math.max(
  Number.parseInt(process.env.REDIS_RETRY_COOLDOWN_MS || "10000", 10) || 0,
  1000
);

const REDIS_WARNING_THROTTLE_MS = 60_000;
const REDIS_STATE_KEY = "__nineRouterRedisCacheState";

function getRedisUrl() {
  if (process.env.REDIS_CACHE_ENABLED === "false") {
    return "";
  }

  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST;
  if (!host) {
    return "";
  }

  const port = process.env.REDIS_PORT || "6379";
  const db = process.env.REDIS_DB || "0";
  const username = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;

  let auth = "";
  if (username) {
    auth = `${encodeURIComponent(username)}:${encodeURIComponent(password || "")}@`;
  } else if (password) {
    auth = `:${encodeURIComponent(password)}@`;
  }

  return `redis://${auth}${host}:${port}/${db}`;
}

function getRedisState() {
  if (!globalThis[REDIS_STATE_KEY]) {
    globalThis[REDIS_STATE_KEY] = {
      client: null,
      connectPromise: null,
      disabledUntil: 0,
      lastWarningAt: 0,
    };
  }

  return globalThis[REDIS_STATE_KEY];
}

function warnRedis(message, error = null) {
  const state = getRedisState();
  const now = Date.now();
  if (now - state.lastWarningAt < REDIS_WARNING_THROTTLE_MS) {
    return;
  }

  state.lastWarningAt = now;

  if (error) {
    console.warn(`[redisCache] ${message}:`, error.message || error);
    return;
  }

  console.warn(`[redisCache] ${message}`);
}

async function getRedisClient() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  const state = getRedisState();

  if (Date.now() < state.disabledUntil) {
    return null;
  }

  if (state.client?.isOpen) {
    return state.client;
  }

  if (state.connectPromise) {
    return state.connectPromise;
  }

  state.connectPromise = (async () => {
    try {
      const redisPkg = await import("redis");
      const createClient = redisPkg.createClient || redisPkg.default?.createClient;

      if (typeof createClient !== "function") {
        warnRedis("Redis package is installed but createClient is unavailable");
        state.disabledUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
        return null;
      }

      const client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          reconnectStrategy: () => false,
        },
      });

      client.on("error", (error) => {
        warnRedis("Redis client error", error);
      });

      await client.connect();
      state.client = client;
      state.disabledUntil = 0;

      return client;
    } catch (error) {
      warnRedis("Redis is configured but unavailable; falling back to local cache", error);
      state.disabledUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
      return null;
    } finally {
      state.connectPromise = null;
    }
  })();

  return state.connectPromise;
}

export async function getRedisJson(key) {
  if (!key) {
    return null;
  }

  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }

    return JSON.parse(value);
  } catch (error) {
    warnRedis(`Failed to read key '${key}'`, error);
    return null;
  }
}

export async function setRedisJson(key, value, ttlSeconds = 0) {
  if (!key) {
    return false;
  }

  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  try {
    const payload = JSON.stringify(value);

    if (ttlSeconds > 0) {
      await client.set(key, payload, { EX: ttlSeconds });
    } else {
      await client.set(key, payload);
    }

    return true;
  } catch (error) {
    warnRedis(`Failed to write key '${key}'`, error);
    return false;
  }
}

export async function deleteRedisJson(key) {
  if (!key) {
    return false;
  }

  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  try {
    await client.del(key);
    return true;
  } catch (error) {
    warnRedis(`Failed to delete key '${key}'`, error);
    return false;
  }
}

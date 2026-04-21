import { createClient } from "redis";
import { randomUUID } from "node:crypto";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_QUEUED = 100;
const DEFAULT_REDIS_RETRY_COOLDOWN_MS = 30000;
const QUEUE_PREFIX = "9router:usage-refresh";
const POLL_INTERVAL_MS = 50;
const REDIS_LOCK_TTL_MS = 5000;
const REDIS_LEASE_TTL_MS = 15 * 60 * 1000;
const MEMORY_STATE = {
  queue: [],
  active: new Set(),
  pumping: false,
};

let redisClient = null;
let redisConnectPromise = null;
let redisRetryAfter = 0;

function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

function buildRedisOptions() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = Number(process.env.REDIS_PORT || 6379);
  const database = process.env.REDIS_DB !== undefined ? Number(process.env.REDIS_DB) : 0;
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;

  return {
    socket: {
      host,
      port,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
      keepAlive: true,
      keepAliveInitialDelay: 5000,
      tls: process.env.REDIS_TLS === "true" || process.env.REDIS_TLS === "1",
    },
    database,
    username,
    password,
    name: process.env.REDIS_CLIENT_NAME || "9router",
  };
}

async function getRedisClient() {
  if (!isRedisConfigured()) return null;
  if (redisClient?.isReady) return redisClient;

  if (redisRetryAfter > Date.now()) {
    return null;
  }

  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      try {
        const client = createClient(buildRedisOptions());
        client.on("error", (err) => {
          console.warn(`[Redis] Client error: ${err?.message || err}`);
        });
        await client.connect();
        redisClient = client;
        redisRetryAfter = 0;
        return client;
      } catch (error) {
        console.warn(`[Redis] Usage queue unavailable: ${error?.message || error}`);
        redisRetryAfter = Date.now() + getRedisRetryCooldownMs();
        redisClient = null;
        return null;
      } finally {
        redisConnectPromise = null;
      }
    })();
  }

  return redisConnectPromise;
}

export function getUsageQueueConcurrency() {
  const parsed = Number.parseInt(process.env.USAGE_QUEUE_CONCURRENCY || "3", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return parsed;
}

export function getUsageQueueWaitTimeoutMs() {
  const parsed = Number.parseInt(process.env.USAGE_QUEUE_WAIT_TIMEOUT_MS || `${DEFAULT_WAIT_TIMEOUT_MS}`, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_WAIT_TIMEOUT_MS;
  return parsed;
}

export function getUsageQueueMaxQueued() {
  const parsed = Number.parseInt(process.env.USAGE_QUEUE_MAX_QUEUED || `${DEFAULT_MAX_QUEUED}`, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_QUEUED;
  return parsed;
}

export function getRedisRetryCooldownMs() {
  const parsed = Number.parseInt(process.env.USAGE_QUEUE_REDIS_RETRY_COOLDOWN_MS || `${DEFAULT_REDIS_RETRY_COOLDOWN_MS}`, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_REDIS_RETRY_COOLDOWN_MS;
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createQueueTimeoutError(connectionId) {
  const error = new Error(`Usage refresh queue timed out for connection ${connectionId}`);
  error.status = 504;
  return error;
}

function createQueueOverloadError() {
  const error = new Error("Usage refresh queue is overloaded. Please retry shortly.");
  error.status = 503;
  return error;
}

function getRedisQueueTtlSeconds() {
  return Math.ceil((REDIS_LEASE_TTL_MS + getUsageQueueWaitTimeoutMs() + 60000) / 1000);
}

async function withMemoryQueue(connectionId, handler) {
  return new Promise((resolve, reject) => {
    if (MEMORY_STATE.queue.length >= getUsageQueueMaxQueued()) {
      reject(createQueueOverloadError());
      return;
    }

    const job = {
      connectionId,
      handler,
      resolve,
      reject,
      timeoutId: null,
    };

    job.timeoutId = setTimeout(() => {
      const index = MEMORY_STATE.queue.indexOf(job);
      if (index !== -1) {
        MEMORY_STATE.queue.splice(index, 1);
        reject(createQueueTimeoutError(connectionId));
      }
    }, getUsageQueueWaitTimeoutMs());

    MEMORY_STATE.queue.push(job);
    pumpMemoryQueue();
  });
}

function pumpMemoryQueue() {
  if (MEMORY_STATE.pumping) return;
  MEMORY_STATE.pumping = true;

  try {
    const concurrency = getUsageQueueConcurrency();
    while (MEMORY_STATE.active.size < concurrency && MEMORY_STATE.queue.length > 0) {
      const job = MEMORY_STATE.queue.shift();
      if (!job) break;

      clearTimeout(job.timeoutId);
      MEMORY_STATE.active.add(job.connectionId);
      Promise.resolve()
        .then(() => job.handler())
        .then(job.resolve, job.reject)
        .finally(() => {
          MEMORY_STATE.active.delete(job.connectionId);
          MEMORY_STATE.pumping = false;
          pumpMemoryQueue();
        });
    }
  } finally {
    MEMORY_STATE.pumping = false;
  }
}

async function acquireRedisLock(client, lockKey, deadlineAt, ttlMs = REDIS_LOCK_TTL_MS) {
  const token = randomUUID();
  while (Date.now() < deadlineAt) {
    const locked = await client.set(lockKey, token, { NX: true, PX: ttlMs });
    if (locked) return token;
    await delay(POLL_INTERVAL_MS);
  }

  throw createQueueTimeoutError("redis-lock");
}

async function releaseRedisLock(client, lockKey, token) {
  try {
    const current = await client.get(lockKey);
    if (current === token) {
      await client.del(lockKey);
    }
  } catch (error) {
    console.warn(`[Redis] Failed to release usage queue lock: ${error?.message || error}`);
  }
}

async function getRedisQueueLength(client, queueKey) {
  if (typeof client.lLen === "function") {
    return client.lLen(queueKey);
  }

  const queued = await client.lRange(queueKey, 0, -1);
  return queued.length;
}

async function isRedisJobQueued(client, queueKey, jobId) {
  if (typeof client.lPos === "function") {
    const position = await client.lPos(queueKey, jobId);
    return position !== null && position !== undefined;
  }

  const queued = await client.lRange(queueKey, 0, -1);
  return queued.includes(jobId);
}

async function removeRedisQueuedJob(client, queueKey, jobId) {
  try {
    await client.lRem(queueKey, 1, jobId);
  } catch (error) {
    console.warn(`[Redis] Failed to remove queued usage job: ${error?.message || error}`);
  }
}

async function enqueueRedisJob(client, queueKey, activeKey, lockKey, jobId, deadlineAt) {
  const lockToken = await acquireRedisLock(client, lockKey, deadlineAt);
  try {
    const activeCount = await client.zCard(activeKey);
    const queueLength = await getRedisQueueLength(client, queueKey);
    if (activeCount + queueLength >= getUsageQueueMaxQueued()) {
      throw createQueueOverloadError();
    }

    await client.rPush(queueKey, jobId);
    await client.expire(queueKey, getRedisQueueTtlSeconds());
  } finally {
    await releaseRedisLock(client, lockKey, lockToken);
  }
}

async function acquireRedisSlot(client, connectionId, jobId, concurrency) {
  const queueKey = `${QUEUE_PREFIX}:queue`;
  const activeKey = `${QUEUE_PREFIX}:active`;
  const lockKey = `${QUEUE_PREFIX}:lock`;
  const queueTtlSeconds = getRedisQueueTtlSeconds();
  const deadlineAt = Date.now() + getUsageQueueWaitTimeoutMs();

  await enqueueRedisJob(client, queueKey, activeKey, lockKey, jobId, deadlineAt);

  while (Date.now() < deadlineAt) {
    const lockToken = await acquireRedisLock(client, lockKey, deadlineAt);
    try {
      const now = Date.now();
      await client.zRemRangeByScore(activeKey, 0, now);
      const activeCount = await client.zCard(activeKey);
      const head = await client.lRange(queueKey, 0, Math.max(0, concurrency - 1));
      const stillQueued = await isRedisJobQueued(client, queueKey, jobId);

      if (!stillQueued) {
        throw createQueueTimeoutError(connectionId);
      }

      if (activeCount < concurrency && head.includes(jobId)) {
        const leaseUntil = now + REDIS_LEASE_TTL_MS;
        const multi = client.multi();
        multi.zAdd(activeKey, [{ score: leaseUntil, value: jobId }]);
        multi.lRem(queueKey, 1, jobId);
        multi.expire(activeKey, Math.ceil(REDIS_LEASE_TTL_MS / 1000));
        multi.expire(queueKey, queueTtlSeconds);
        await multi.exec();
        return;
      }
    } finally {
      await releaseRedisLock(client, lockKey, lockToken);
    }

    await delay(POLL_INTERVAL_MS);
  }

  await removeRedisQueuedJob(client, queueKey, jobId);
  throw createQueueTimeoutError(connectionId);
}

async function releaseRedisSlot(client, jobId) {
  const activeKey = `${QUEUE_PREFIX}:active`;
  try {
    await client.zRem(activeKey, jobId);
    await client.expire(activeKey, 60);
  } catch (error) {
    console.warn(`[Redis] Failed to release usage queue slot: ${error?.message || error}`);
  }
}

async function withRedisQueue(connectionId, handler) {
  const client = await getRedisClient();
  if (!client) {
    return withMemoryQueue(connectionId, handler);
  }

  const concurrency = getUsageQueueConcurrency();
  const jobId = `${Date.now()}-${randomUUID()}`;

  await acquireRedisSlot(client, connectionId, jobId, concurrency);
  try {
    return await handler();
  } finally {
    await releaseRedisSlot(client, jobId);
  }
}

export async function runUsageRefreshJob(connectionId, handler) {
  if (!connectionId || typeof handler !== "function") {
    throw new Error("runUsageRefreshJob requires a connectionId and handler");
  }

  if (isRedisConfigured()) {
    return withRedisQueue(connectionId, handler);
  }

  return withMemoryQueue(connectionId, handler);
}

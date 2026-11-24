import { randomUUID } from "node:crypto";
import { defaults, evaluate, severity } from "./rules.js";
import { channelConfig, send } from "./transport.js";

export const inRange = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
export const thresholds = repo => repo.thresholds() ?? defaults;
export function saveThresholds(repo, { minRequests, errorPercent }) {
  if (!inRange(minRequests, 1, 1000000) || !inRange(errorPercent, 1, 100)) throw new Error("Invalid thresholds");
  repo.saveThresholds({ minRequests, errorPercent });
}
export async function addChannel(repo, input, resolve) {
  if (!inRange(input.perMinute, 1, 120)) throw new Error("Invalid rate limit");
  const config = await channelConfig(input, resolve);
  const id = randomUUID();
  repo.insertChannel(id, input.kind, config, input.perMinute);
  return id;
}
export function settings(repo, now) {
  return { channels: repo.channels(),
    thresholds: thresholds(repo), mutes: repo.mutes(now) };
}
export function addMute(repo, { type, target, minutes }, now) {
  if ((!type && !target) || (type && !Object.hasOwn(severity, type)) ||
    (target && !/^(gateway|backup|data|key:[a-f0-9-]{36,64}|connection:[a-f0-9-]{8,32})$/i.test(target))
    || !inRange(minutes, 1, 525600)) throw new Error("Invalid mute");
  repo.insertMute(type || null, target || null, now + minutes * 60_000);
}

export function reconcile(repo, snapshot, now) {
  repo.reconcile(now, () => evaluate(snapshot, now, thresholds(repo)), type =>
    (type === "backup.failed" && snapshot.backup == null) || (type === "disk.critical" && snapshot.diskPercent == null));
}

async function dispatch(repo, channel, payload, transport) {
  try { return await transport(channel.kind, repo.channelConfig(channel), payload); }
  catch { return false; }
}
export async function testChannel(repo, id, now = Date.now(), transport = send) {
  const channel = repo.channel(id);
  if (!channel) return 404;
  const payload = repo.claim(channel, now, true);
  return !payload ? 429 : await dispatch(repo, channel, payload, transport) ? 200 : 502;
}
export async function drain(repo, clock = Date.now, transport = send) {
  repo.pruneDeliveries(clock() - 60_000);
  await Promise.all(repo.deliveryChannels().map(async channel => {
    for (let n = 0; n < channel.perMinute; n++) {
      const row = repo.claim(channel, clock(), false);
      if (!row) break;
      await dispatch(repo, channel, row, transport);
    }
  }));
}

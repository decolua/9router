/**
 * Qoder 稳定设备指纹派生（移植自 qoder2api-hub / qoder_fingerprint.py）。
 *
 * 目的：以账号 UID 为种子单向派生固定的伪物理设备特征，保证
 *   1) 同一账号长期来自同一台虚拟设备（避免机器码漂移触发风控）；
 *   2) 多账号之间机器码彼此独立（阻断跨账号关联）。
 *
 * 注意：本模块派生的是「兜底身份」。活动平台（/sash/...）按真实机器身份
 * 过滤设备定向活动，派生值会让列表静默少活动；优先用 nativeIdentity.js
 * 从官方 runtime-info.exe 取真值，取不到才回退到这里。
 * [qoder 权益 v0.6.0]
 */

import crypto from "crypto";

/**
 * 由 uid + salt 稳定派生十六进制标识（幂等）。
 * 注意：md5 摘要为 32 位十六进制（参考实现注释写 36 位有误，行为以 32 位为准）。
 */
export function deriveId(uid, salt) {
  const seed = `${salt}:${uid || "anonymous"}`;
  return crypto.createHash("md5").update(seed, "utf8").digest("hex").slice(0, 36);
}

/** 派生带稳定前缀 + 微秒时间戳的请求 ID（防风控/可溯源）。 */
export function generateRequestId(uid) {
  const prefix = deriveId(uid, "req");
  const suffix = String(process.hrtime.bigint() % 1000000n).padStart(6, "0");
  return `${prefix}-${suffix}`;
}

/** 稳定派生 18 位去横线的 machineType（与 cosy-machinetoken 同形）。 */
export function deriveMachineType(uid) {
  return deriveId(uid, "machinetype").replace(/-/g, "").slice(0, 18);
}

/** 稳定派生 machineToken（base64url 外观的随机串，43 位）。 */
export function deriveMachineToken(uid) {
  const raw = crypto.createHash("sha512").update(`machinetoken:${uid}`, "utf8").digest();
  return raw.toString("base64url").slice(0, 43);
}

/** 稳定派生 machineCode（派生身份下的兜底值）。 */
export function deriveMachineCode(uid) {
  return deriveId(uid, "machinecode");
}

/** 稳定派生 machineId（COSY 头与普通请求头共用）。 */
export function deriveMachineId(uid) {
  return deriveId(uid, "machine");
}

/** 稳定派生 sessionId。 */
export function deriveSessionId(uid) {
  return deriveId(uid, "session");
}
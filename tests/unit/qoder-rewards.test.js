/**
 * Qoder 权益移植（[qoder 权益 v0.6.0]）单元测试。
 *
 * 覆盖不触网、不依赖 DB 的纯逻辑：设备指纹派生、本地凭证解密原语、
 * 时间戳归一、任务视图字段与签到判定、调度器状态。
 *
 * 运行：cd tests && npm install && npx vitest run unit/qoder-rewards.test.js
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

import {
  deriveId,
  deriveMachineId,
  deriveSessionId,
  deriveMachineToken,
  deriveMachineType,
  deriveMachineCode,
  generateRequestId,
} from "../../open-sse/shared/qoder/fingerprint.js";
import { aesCbcDecrypt, aesGcmDecrypt, chromiumDecryptV10 } from "../../open-sse/shared/qoder/crypto.js";
import { normalizeEpoch } from "../../open-sse/shared/qoder/localCredentials.js";
import {
  QODER_PROVIDER_IDS,
  canCheckin,
  campaignLabel,
  uidOf,
  regionOf,
  tokenOf,
} from "../../src/lib/qoder/rewards.js";
import { qoderSchedulerStatus, setQoderSchedulerEnabled } from "../../src/shared/services/qoderScheduler.js";

describe("qoder fingerprint（稳定设备指纹）", () => {
  it("deriveId 为 32 位十六进制且幂等", () => {
    const a = deriveId("uid-1", "machine");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveId("uid-1", "machine")).toBe(a);
  });

  it("不同 uid / 不同 salt 派生不同值（多账号天然隔离）", () => {
    expect(deriveId("uid-2", "machine")).not.toBe(deriveId("uid-1", "machine"));
    expect(deriveId("uid-1", "session")).not.toBe(deriveId("uid-1", "machine"));
  });

  it("machineId/sessionId/machineCode 各自稳定且互不相同", () => {
    const ids = [deriveMachineId("u"), deriveSessionId("u"), deriveMachineCode("u")];
    expect(new Set(ids).size).toBe(3);
    expect(deriveMachineId("u")).toBe(ids[0]);
  });

  it("machineToken 为 43 位 base64url，machineType 为 18 位", () => {
    expect(deriveMachineToken("u")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveMachineType("u")).toHaveLength(18);
  });

  it("generateRequestId 带稳定前缀 + 6 位后缀", () => {
    const id = generateRequestId("u");
    expect(id.startsWith(deriveId("u", "req"))).toBe(true);
    expect(id.split("-").pop()).toHaveLength(6);
  });

  it("空 uid 也有稳定兜底（anonymous）", () => {
    expect(deriveId("", "machine")).toBe(deriveId("", "machine"));
    expect(deriveId(null, "machine")).toBe(deriveId("", "machine"));
  });
});

describe("qoder crypto（本地凭证解密原语）", () => {
  const key = Buffer.from("0123456789abcdef", "utf8");
  const iv = Buffer.from("abcdef0123456789", "utf8");

  it("aesCbcDecrypt 与 Node 自带 AES-128-CBC 互通", () => {
    const plain = Buffer.from("qoder-credential-json", "utf8");
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    expect(aesCbcDecrypt(enc, key, iv).toString("utf8")).toBe("qoder-credential-json");
  });

  it("aesCbcDecrypt 严格校验 PKCS7 填充（坏填充抛错）", () => {
    expect(() => aesCbcDecrypt(Buffer.alloc(16, 7), key, iv)).toThrow();
  });

  it("aesCbcDecrypt 拒绝非 16 字节 key/iv 与非对齐密文", () => {
    expect(() => aesCbcDecrypt(Buffer.alloc(16), Buffer.alloc(8), iv)).toThrow(/16 bytes/);
    expect(() => aesCbcDecrypt(Buffer.alloc(15), key, iv)).toThrow(/block aligned/);
  });

  it("chromiumDecryptV10 拒绝非 v10 载荷，接受合法 v10 载荷", () => {
    expect(() => chromiumDecryptV10(Buffer.from("v11xxxxxxxx"), Buffer.alloc(32))).toThrow(/v10/);

    const gcmKey = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);
    const plain = Buffer.from(JSON.stringify({ token: "dt-x" }), "utf8");
    const g = crypto.createCipheriv("aes-256-gcm", gcmKey, nonce);
    const ct = Buffer.concat([g.update(plain), g.final(), g.getAuthTag()]);
    const blob = Buffer.concat([Buffer.from("v10"), nonce, ct]);
    expect(chromiumDecryptV10(blob, gcmKey).toString("utf8")).toContain("dt-x");
  });

  it("aesGcmDecrypt 校验 tag（篡改即抛错）", () => {
    const gcmKey = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);
    const g = crypto.createCipheriv("aes-256-gcm", gcmKey, nonce);
    const sealed = Buffer.concat([g.update(Buffer.from("payload")), g.final(), g.getAuthTag()]);
    expect(aesGcmDecrypt(gcmKey, nonce, sealed).toString("utf8")).toBe("payload");
    sealed[0] ^= 0xff;
    expect(() => aesGcmDecrypt(gcmKey, nonce, sealed)).toThrow();
  });
});

describe("normalizeEpoch（时间戳归一）", () => {
  it("秒 / 毫秒 / 微秒 都能归一", () => {
    expect(normalizeEpoch(1700000000)).toBe(1700000000);
    expect(normalizeEpoch(1700000000000)).toBe(1700000000);
    expect(normalizeEpoch(1700000000000000)).toBe(1700000000);
  });

  it("RFC3339 字符串与空值", () => {
    expect(normalizeEpoch("2026-10-02T12:00:00")).toBeGreaterThan(0);
    expect(normalizeEpoch("")).toBe(0);
    expect(normalizeEpoch(null)).toBe(0);
    expect(normalizeEpoch("not-a-date")).toBe(0);
  });
});

describe("rewards 纯逻辑", () => {
  const conn = {
    id: "conn-1",
    provider: "qoder",
    accessToken: "dt-abc",
    providerSpecificData: { userId: "uid-9" },
  };

  it("provider 映射到区域与传统字段", () => {
    expect(QODER_PROVIDER_IDS).toEqual(["qoder", "qoder-cn"]);
    expect(regionOf({ provider: "qoder" })).toBe("intl");
    expect(regionOf({ provider: "qoder-cn" })).toBe("cn");
    expect(uidOf(conn)).toBe("uid-9");
    expect(uidOf({ id: "only-id" })).toBe("only-id");
    expect(tokenOf(conn)).toBe("dt-abc");
    expect(tokenOf({ apiKey: "pt-x" })).toBe("pt-x");
  });

  it("campaignLabel 优先中文标题，其次 key", () => {
    expect(campaignLabel({ title_zh: "每天领 100 Credits", campaign_key: "act-1" })).toBe("每天领 100 Credits");
    expect(campaignLabel({ campaign_key: "act-1" })).toBe("act-1");
    expect(campaignLabel({})).toBe("");
  });

  it("canCheckin：没签过要签，今天签过不再签，昨天签过要签", () => {
    expect(canCheckin({ id: "a", lastCheckin: "" })).toBe(true);
    const today = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const stamp = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 10:00:00`;
    expect(canCheckin({ id: "b", lastCheckin: stamp(today) })).toBe(false);
    const yesterday = new Date(today.getTime() - 86400000);
    expect(canCheckin({ id: "c", lastCheckin: stamp(yesterday) })).toBe(true);
  });

  // 注：连接解析（getQoderConnection / listQoderConnections）会打开 SQLite，
  // 属于集成测试范畴，这里**刻意不测**以免在单测中创建数据库文件。
});

describe("qoderScheduler 状态", () => {
  it("status 暴露排程与开关字段", () => {
    setQoderSchedulerEnabled(true);
    const st = qoderSchedulerStatus();
    expect(st).toHaveProperty("started");
    expect(st).toHaveProperty("enabled");
    expect(st.mode).toContain("09:00");
    expect(st.mode).toContain("21:00");
    expect(Array.isArray(st.logs)).toBe(true);
  });
});
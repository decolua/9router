/**
 * 本机已登录凭证的只读探测与导入（移植自 qoder2api-hub / qoder_accounts.py 的
 * scan_desktop_credentials / _load_app_auth / _load_cli_user / import_desktop_credential）。
 *
 * 两类官方存储：
 *   1. 桌面 App（Electron）： %APPDATA%\com.qoder[cn].app.stable\auth.v1.dat
 *      布局 "v10" + AES-256-GCM；密钥在同目录 Local State 的 os_crypt.encrypted_key
 *      （DPAPI 保护）→ 剥 "DPAPI" 前缀 → dpapiUnprotect 解出 32 字节 key。
 *      明文 schema: { schemaVersion, token(dt-), refreshToken(drt-), expiresAt,
 *                     user:{ id, name, email, ... } }
 *   2. CLI/官方客户端： ~/.qoder[cn]/.auth/user[.{profile}]
 *      AES-128-CBC，key=iv=machine_id 前 16 字符，标准 Base64（严格填充）；
 *      明文 UserInfo JSON（也兼容以 "{" 开头的明文形态）。
 *
 * 扫描全程只读，且**不返回任何明文令牌**（只报可读性/有效性/uid/昵称/过期时间）；
 * 导入必须由用户在看板二次确认后，才由 readCredentialForImport 取出令牌。
 * [qoder 权益 v0.6.0]
 */

import fs from "fs";
import os from "os";
import path from "path";

import { aesCbcDecrypt, chromiumDecryptV10, dpapiUnprotect } from "./crypto.js";
import { QODER_DESKTOP_DIRS } from "./constants.js";

/** 时间戳归一：支持秒/毫秒/微秒纪元与 RFC3339 字符串；无法解析返回 0。 */
export function normalizeEpoch(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "string" && value.includes("-")) {
    const t = Date.parse(value.length > 19 ? value.slice(0, 19) : value);
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 量级判别（当前纪元）：秒≈1.7e9 · 毫秒≈1.7e12 · 微秒≈1.7e15 · 纳秒≈1.7e18
  if (n >= 1e16) return Math.floor(n / 1e9); // 纳秒
  if (n >= 1e13) return Math.floor(n / 1e6); // 微秒
  if (n >= 1e11) return Math.floor(n / 1e3); // 毫秒
  return Math.floor(n); // 秒
}

function roamingAppDir(realm) {
  const cfg = QODER_DESKTOP_DIRS[realm] || QODER_DESKTOP_DIRS.intl;
  const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, cfg.appDir);
}

function cliAuthDir(realm) {
  const cfg = QODER_DESKTOP_DIRS[realm] || QODER_DESKTOP_DIRS.intl;
  return path.join(os.homedir(), cfg.homeDir, ".auth");
}

/** Local State.os_crypt.encrypted_key → DPAPI 解出的 32 字节 AES key。 */
function readChromiumOsCryptKey(appDir) {
  const file = path.join(appDir, "Local State");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const ek = state?.os_crypt?.encrypted_key;
  if (!ek) throw new Error("Local State has no os_crypt.encrypted_key");
  const blob = Buffer.from(ek, "base64");
  if (blob.subarray(0, 5).toString("latin1") !== "DPAPI") {
    throw new Error(`unexpected encrypted_key header ${JSON.stringify(blob.subarray(0, 5).toString("latin1"))}`);
  }
  return dpapiUnprotect(blob.subarray(5));
}

/** 解出桌面 App auth.v1.dat 的明文对象；失败抛异常。 */
export function loadAppAuth(realm) {
  const appDir = roamingAppDir(realm);
  const key = readChromiumOsCryptKey(appDir);
  const blob = fs.readFileSync(path.join(appDir, "auth.v1.dat"));
  const data = JSON.parse(chromiumDecryptV10(blob, key).toString("utf8"));
  if (!data || typeof data !== "object" || !data.token) {
    throw new Error("auth.v1.dat has unexpected schema");
  }
  return data;
}

/** 解 CLI 端 ~/.qoder[cn]/.auth/user（AES-128-CBC）或明文兼容形态。 */
export function loadCliUser(file, machineKey) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (raw.startsWith("{")) return JSON.parse(raw);
  const key = Buffer.from(String(machineKey || "").slice(0, 16), "utf8");
  if (key.length !== 16) throw new Error("machine_id shorter than 16 bytes");
  const plain = aesCbcDecrypt(Buffer.from(raw, "base64"), key, key);
  return JSON.parse(plain.toString("utf8"));
}

function humanDelta(seconds) {
  if (seconds <= 0) return "已过期";
  if (seconds >= 86400) return `${(seconds / 86400).toFixed(1)} 天`;
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${Math.round(seconds / 60)} 分钟`;
}

function readMachineKey(authDir) {
  try {
    return fs.readFileSync(path.join(authDir, "machine_id"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 只读探测本机双区已登录凭证。返回候选列表（**不含任何明文令牌**）。
 * @returns {Array<{kind,path,file,realm,realmName,readable,valid,uid,nickname,expiresAt,expiresIn,error}>}
 */
export function scanLocalCredentials() {
  const found = [];
  for (const realm of ["intl", "cn"]) {
    const cfg = QODER_DESKTOP_DIRS[realm] || QODER_DESKTOP_DIRS.intl;

    // 1) 桌面 App (auth.v1.dat)
    const appPath = path.join(roamingAppDir(realm), "auth.v1.dat");
    const appItem = {
      kind: "app",
      path: appPath,
      file: "auth.v1.dat",
      realm,
      realmName: cfg.name,
      domain: cfg.domain,
      readable: false,
      valid: false,
      uid: "",
      nickname: "",
      expiresAt: 0,
      expiresIn: null,
      error: "",
    };
    try {
      const data = loadAppAuth(realm);
      const user = data.user || {};
      const exp = normalizeEpoch(data.expiresAt);
      appItem.readable = true;
      appItem.valid = String(data.token || "").startsWith("dt-") || !!data.refreshToken;
      appItem.uid = String(user.id || "");
      appItem.nickname = String(user.name || "");
      appItem.expiresAt = exp;
      appItem.expiresIn = exp ? humanDelta(exp - Date.now() / 1000) : null;
    } catch (err) {
      appItem.error = err?.code === "ENOENT"
        ? "not found (未登录或未安装该版本客户端)"
        : String(err?.message || err);
    }
    found.push(appItem);

    // 2) CLI 端 user / user.{profile}
    const authDir = cliAuthDir(realm);
    if (fs.existsSync(authDir)) {
      const machineKey = readMachineKey(authDir);
      let names = [];
      try {
        names = fs.readdirSync(authDir).filter((n) => n === "user" || n.startsWith("user."));
      } catch {
        names = [];
      }
      for (const name of names) {
        const file = path.join(authDir, name);
        const item = {
          kind: "cli",
          path: file,
          file: name,
          realm,
          realmName: cfg.name,
          domain: cfg.domain,
          readable: false,
          valid: false,
          uid: "",
          nickname: "",
          expiresAt: 0,
          expiresIn: null,
          error: "",
        };
        try {
          const data = loadCliUser(file, machineKey);
          const token = String(data.access_token || "");
          const exp = normalizeEpoch(data.expire_time);
          item.readable = true;
          item.valid = token.startsWith("dt-") || token.startsWith("jt-");
          item.uid = String(data.uid || "");
          item.nickname = String(data.name || "");
          item.expiresAt = exp;
          item.expiresIn = exp ? humanDelta(exp - Date.now() / 1000) : null;
        } catch (err) {
          item.error = String(err?.message || err);
        }
        found.push(item);
      }
    }
  }
  return found;
}

/**
 * 取出某个已扫描凭证的令牌（仅在看板二次确认后调用）。
 * @returns {{accessToken,refreshToken,uid,nickname,expiresAt,realm}}
 */
export function readCredentialForImport(filePath, realmHint) {
  let realm = realmHint;
  let matched = null;
  try {
    matched = scanLocalCredentials().find(
      (i) => path.resolve(i.path).toLowerCase() === path.resolve(filePath).toLowerCase(),
    );
  } catch {
    matched = null;
  }
  if (matched) realm = matched.realm;
  if (realm !== "cn" && realm !== "intl") realm = "intl";

  const base = path.basename(filePath);
  if (base === "auth.v1.dat") {
    const data = loadAppAuth(realm);
    const user = data.user || {};
    return {
      accessToken: String(data.token || ""),
      refreshToken: String(data.refreshToken || ""),
      uid: String(user.id || ""),
      nickname: String(user.name || ""),
      expiresAt: normalizeEpoch(data.expiresAt),
      realm,
    };
  }
  const data = loadCliUser(filePath, readMachineKey(cliAuthDir(realm)));
  return {
    accessToken: String(data.access_token || ""),
    refreshToken: String(data.refresh_token || ""),
    uid: String(data.uid || ""),
    nickname: String(data.name || ""),
    expiresAt: normalizeEpoch(data.expire_time),
    realm,
  };
}
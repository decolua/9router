/**
 * 本地凭证解密原语（移植自 qoder2api-hub / qoder_sign.py）。
 *
 * 只用于「本机凭证扫描导入」：读取官方客户端已落盘的登录凭证。
 *   - AES-128-CBC ：CLI 端 ~/.qoder[.cn]/.auth/user（key=iv=machine_id 前 16 字符）
 *   - AES-256-GCM ：桌面 App auth.v1.dat 的 Chromium os_crypt "v10" 载荷
 *   - DPAPI       ：解 Local State 里 os_crypt.encrypted_key（Windows 用户态保护）
 *
 * Node 自带 AES，无需自实现；DPAPI 没有原生能力，走 PowerShell 的
 * ProtectedData.Unprotect 桥（零额外依赖，仅 Windows 可用）。
 * [qoder 权益 v0.6.0]
 */

import crypto from "crypto";
import { spawnSync } from "child_process";

/** AES-128-CBC 解密 + 严格 PKCS7 校验（与参考实现一致，不容忍坏填充）。 */
export function aesCbcDecrypt(data, key, iv) {
  if (key.length !== 16 || iv.length !== 16) {
    throw new Error(`aes key/iv must be 16 bytes, got ${key.length}/${iv.length}`);
  }
  if (!data.length || data.length % 16 !== 0) {
    throw new Error(`ciphertext length ${data.length} not block aligned`);
  }
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  const pad = out[out.length - 1];
  if (pad < 1 || pad > 16) throw new Error("bad PKCS7 padding");
  for (let i = out.length - pad; i < out.length; i++) {
    if (out[i] !== pad) throw new Error("bad PKCS7 padding");
  }
  return out.subarray(0, out.length - pad);
}

/** AES-GCM 解密（key 支持 16/32 字节），带 tag 严格校验。 */
export function aesGcmDecrypt(key, nonce, sealed) {
  if (sealed.length < 16) throw new Error("gcm payload too short");
  if (nonce.length !== 12) throw new Error("gcm nonce must be 12 bytes");
  if (key.length !== 16 && key.length !== 32) {
    throw new Error(`gcm key must be 16/32 bytes, got ${key.length}`);
  }
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const decipher = crypto.createDecipheriv(key.length === 32 ? "aes-256-gcm" : "aes-128-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** 解 Chromium/Electron os_crypt "v10" 载荷：v10(3) + nonce(12) + AES-256-GCM。 */
export function chromiumDecryptV10(blob, key) {
  if (blob.subarray(0, 3).toString("latin1") !== "v10") {
    throw new Error("not a v10 payload");
  }
  return aesGcmDecrypt(key, blob.subarray(3, 15), blob.subarray(15));
}

/**
 * Windows DPAPI CryptUnprotectData（用户态）。
 * 走 PowerShell 桥：数据以 base64 经 stdin 进出，避免命令行长度/转义问题。
 */
export function dpapiUnprotect(data) {
  if (process.platform !== "win32") {
    throw new Error("DPAPI only available on Windows");
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    // ProtectedData / DataProtectionScope 在 System.Security 程序集里，必须先加载
    // （Windows PowerShell 5.1 默认没加载，否则报 "找不到类型 DataProtectionScope"）
    "Add-Type -AssemblyName System.Security",
    "$b=[Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())",
    "$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser",
    "$r=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,$scope)",
    "[Console]::Out.Write([Convert]::ToBase64String($r))",
  ].join(";");
  const proc = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: Buffer.from(data).toString("base64"), timeout: 20000, windowsHide: true },
  );
  if (proc.error) throw new Error(`DPAPI bridge failed: ${proc.error.message}`);
  const out = String(proc.stdout || "").trim();
  if (proc.status !== 0 || !out) {
    const err = String(proc.stderr || "").trim();
    throw new Error(`DPAPI Unprotect failed: ${err || `exit ${proc.status}`}`);
  }
  return Buffer.from(out, "base64");
}
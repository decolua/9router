/**
 * Qoder 官方原生机身身份桥（移植自 qoder2api-hub / qoder_accounts.py 的
 * desktop_install_dir / runtime_info_exe / run_runtime_info / native_machine_identity）。
 *
 * 为什么必须用它：官方桌面端在拉活动列表前，会 spawn 自带的原生风控桥
 *   <install>/resources/umid/runtime-info.exe prod --account-stdin
 *   stdin : {"account": <uid>}      stdout: {"machineToken","machineType","machineCode",…}
 * 服务端按这些值过滤**设备定向活动**。「每日领取 100 Credits」就属于其中之一：
 * 用派生假身份不会报错，但列表里会静默少掉这些条目 —— 这就是「签到领不到」的根因。
 *
 * 身份是**机器级**的（不同 account id 返回同一份），按区域缓存 30 分钟即可；
 * 身份会随时间轮换，但旧身份仍被服务端接受，真正的成本只是每次要跑约 3.7 秒的
 * 官方二进制。列表被判定为未认可时由调用方 force 刷新一次兜底自愈。
 *
 * 可用环境变量 QD_NATIVE_IDENTITY=0 关闭（测试/受限环境不希望拉起客户端二进制时）。
 * [qoder 权益 v0.6.0]
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { QODER_DESKTOP_INSTALL_NAMES, QODER_NATIVE_IDENTITY_TTL_MS } from "./constants.js";

// exe 路径缓存（进程内）：按区域缓存，找不到记空串避免每次 stat。
const _exeCache = new Map();
// 身份缓存：realm -> { at, ident }
const _identCache = new Map();

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

/** 读 launcher 的 state.ini（UTF-8 或 UTF-16），取 key=value 的 value。 */
function readIni(file, key) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return "";
  }
  for (const enc of ["utf8", "utf16le"]) {
    let text;
    try {
      text = raw.toString(enc);
    } catch {
      continue;
    }
    // utf8 读 UTF-16 文件会得到含 NUL 的乱码，这里顺带用去 BOM 的方式归一
    text = text.replace(/^\uFEFF/, "");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      const idx = t.indexOf("=");
      if (idx === -1) continue;
      if (t.slice(0, idx).trim().toLowerCase() === key.toLowerCase()) {
        return t.slice(idx + 1).trim();
      }
    }
  }
  return "";
}

/** 桌面端安装目录（定位 launcher state.ini 的 installDir）；找不到返回空串。 */
export function desktopInstallDir(realm) {
  const base = localAppData();
  const names = QODER_DESKTOP_INSTALL_NAMES[realm] || QODER_DESKTOP_INSTALL_NAMES.intl;
  for (const name of names) {
    for (const launcher of [`${name} Launcher`, "Launcher"]) {
      const ini = path.join(base, name, launcher, "state.ini");
      if (fs.existsSync(ini)) {
        const dir = readIni(ini, "installDir");
        if (dir && fs.existsSync(dir)) return dir;
      }
    }
  }
  for (const name of names) {
    const dir = path.join(base, "Programs", name);
    if (fs.existsSync(dir)) return dir;
  }
  return "";
}

/** 定位官方 runtime-info.exe；被 QD_NATIVE_IDENTITY=0 关闭或找不到时返回空串。 */
export function runtimeInfoExe(realm) {
  const flag = String(process.env.QD_NATIVE_IDENTITY ?? "1").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return "";
  if (_exeCache.has(realm)) return _exeCache.get(realm);
  let found = "";
  const root = path.join(desktopInstallDir(realm), "resources", "umid");
  const cand = path.join(root, "runtime-info.exe");
  if (fs.existsSync(cand)) found = cand;
  _exeCache.set(realm, found);
  return found;
}

/**
 * 调用官方 runtime-info.exe，返回其 JSON（失败返回 {}）。
 * account 传空串也可用：机器身份是机器级的。
 */
export function runRuntimeInfo(realm, accountId = "") {
  const exe = runtimeInfoExe(realm);
  if (!exe) return {};
  try {
    // 官方二进制读 stdin 的 JSON（尾部空格与客户端一致）
    const input = `${JSON.stringify({ account: accountId || "" })} `;
    const proc = spawnSync(exe, ["prod", "--account-stdin"], {
      input,
      cwd: path.dirname(exe),
      timeout: 25000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (proc.error || proc.status !== 0) return {};
    const out = String(proc.stdout || "").trim();
    if (!out) return {};
    return JSON.parse(out.split("\n")[0]);
  } catch {
    return {};
  }
}

/**
 * 取真实机器身份；任何失败返回 {}（调用方回退派生值）。
 * @returns {{machineToken,machineType,machineCode,vm,vmInfo,source}|{}}
 */
export function nativeMachineIdentity(realm, accountId = "", { force = false } = {}) {
  const now = Date.now();
  if (!force) {
    const hit = _identCache.get(realm);
    if (hit && now - hit.at < QODER_NATIVE_IDENTITY_TTL_MS) return hit.ident;
  }
  let ident = {};
  const data = runRuntimeInfo(realm, accountId);
  if (data) {
    const token = String(data.machineToken || "").trim();
    const mtype = String(data.machineType || "").trim();
    const code = String(data.machineCode || "").trim();
    const vmInfo = data.vmInfo && typeof data.vmInfo === "object" ? data.vmInfo : {};
    if (token && mtype && code) {
      ident = {
        machineToken: token,
        machineType: mtype,
        machineCode: code,
        vm: !!vmInfo.isVm,
        vmInfo,
        source: "runtime-info",
      };
    }
  }
  _identCache.set(realm, { at: now, ident });
  return ident;
}

/** 官方风控桥是否可用（看板/诊断可显示"派生身份"降级提示）。 */
export function nativeBridgeAvailable(realm) {
  return !!runtimeInfoExe(realm);
}

/** 仅供测试：清空进程内缓存。 */
export function _resetNativeCaches() {
  _exeCache.clear();
  _identCache.clear();
}
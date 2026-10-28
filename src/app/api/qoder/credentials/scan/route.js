import { NextResponse } from "next/server";

import { scanLocalCredentials } from "open-sse/shared/qoder/localCredentials.js";
import { nativeBridgeAvailable } from "open-sse/shared/qoder/nativeIdentity.js";

/**
 * GET /api/qoder/credentials/scan
 *
 * 只读探测本机双区（桌面 App / CLI）已登录的 Qoder 凭证。
 * **不返回任何明文令牌**——只报可读性/有效性/uid/昵称/过期时间；
 * 导入需走 /api/qoder/credentials/import 二次确认。
 *
 * 该路由会读取本机凭证文件并（桌面 App 路径）拉起 PowerShell 做 DPAPI 解密，
 * 因此已在 dashboardGuard 的 LOCAL_ONLY_PATHS 中限制为仅本机可访问。
 */
export async function GET() {
  try {
    const items = scanLocalCredentials();
    return NextResponse.json({
      items,
      platform: process.platform,
      // 桌面 App 凭证需要 DPAPI，仅 Windows 可解
      dpapiAvailable: process.platform === "win32",
      // 原生机身身份桥是否可用（影响签到能否拿到设备定向活动）
      nativeBridge: {
        intl: nativeBridgeAvailable("intl"),
        cn: nativeBridgeAvailable("cn"),
      },
    });
  } catch (error) {
    console.error("[API] Qoder credential scan failed:", error);
    return NextResponse.json({ error: "Credential scan failed" }, { status: 500 });
  }
}
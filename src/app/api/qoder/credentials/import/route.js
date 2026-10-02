import { NextResponse } from "next/server";

import { createProviderConnection } from "@/models";
import { readCredentialForImport, scanLocalCredentials } from "open-sse/shared/qoder/localCredentials.js";

/** realm → provider id 映射（与 9router 的 provider 注册表一致）。 */
const REALM_PROVIDER = { intl: "qoder", cn: "qoder-cn" };

function toIso(epochSeconds) {
  if (!epochSeconds) return undefined;
  return new Date(epochSeconds * 1000).toISOString();
}

async function importOne(filePath, realm) {
  const cred = readCredentialForImport(filePath, realm);
  if (!cred?.accessToken) throw new Error("未从该文件解出可用令牌");
  const provider = REALM_PROVIDER[cred.realm] || "qoder";
  // 去重依赖 email：无真实邮箱时用 uid 派生稳定标识（与 OAuth 入池规则一致）
  const email = cred.uid ? `qoder-user-${cred.uid}` : undefined;
  const connection = await createProviderConnection({
    provider,
    authType: "oauth",
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken || undefined,
    expiresAt: toIso(cred.expiresAt),
    email,
    displayName: cred.nickname || undefined,
    providerSpecificData: {
      authMethod: "local-import",
      userId: cred.uid || "",
      importedFrom: filePath,
    },
    allowOverwrite: true,
  });
  return {
    id: connection.id,
    provider,
    nickname: cred.nickname || cred.uid || connection.id.slice(0, 8),
    realm: cred.realm,
    file: filePath,
  };
}

/**
 * POST /api/qoder/credentials/import
 * body: { path: string, realm?: "intl"|"cn" }   导入单个
 *     | { all: true }                            导入全部有效项
 *
 * 这是写入账号池的动作，必须由用户在扫描结果上二次确认后调用。
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.all) {
      const candidates = scanLocalCredentials().filter((i) => i.valid);
      const imported = [];
      const errors = [];
      for (const item of candidates) {
        try {
          imported.push(await importOne(item.path, item.realm));
        } catch (err) {
          errors.push(`${item.realm}/${item.file}: ${err?.message ?? err}`);
        }
      }
      return NextResponse.json({ ok: imported.length > 0, imported, errors });
    }

    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required (或传 all:true)" }, { status: 400 });
    }
    const result = await importOne(body.path, body.realm);
    return NextResponse.json({ ok: true, imported: [result], errors: [] });
  } catch (error) {
    console.error("[API] Qoder credential import failed:", error);
    return NextResponse.json({ error: String(error?.message || "Credential import failed") }, { status: 500 });
  }
}
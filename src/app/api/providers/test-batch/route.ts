import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnections } from "@/models";
import {
  FREE_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { testSingleConnection } from "../[id]/test/testUtils.js";

function getAuthGroup(providerId: string, connection: ProviderConnection | null = null) {
  if (connection?.authType) {
    if (connection.authType === "oauth") {
      if (FREE_PROVIDERS[providerId]) return "free";
      return "oauth";
    }
    return connection.authType;
  }

  if (FREE_PROVIDERS[providerId]) return "free";
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (APIKEY_PROVIDERS[providerId]) return "apikey";
  if (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
    return "compatible";
  return "apikey";
}

function isCompatibleProvider(providerId: string) {
  return (
    providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) ||
    providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)
  );
}

interface TestResult {
  provider: string;
  connectionId: string;
  connectionName: string;
  authType: string;
  valid: boolean;
  latencyMs: number;
  error: string | null;
  diagnosis: JsonValue | null;
  statusCode: number | null;
  testedAt: string;
}

// POST /api/providers/test-batch - Test multiple connections by group
export async function POST(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    const body = await request.json() as { mode?: string; providerId?: string };
    const { mode, providerId } = body;

    if (!mode) {
      return NextResponse.json({ error: "mode is required" }, { status: 400 });
    }

    const allConnections = await getProviderConnections({ isActive: true });

    let connectionsToTest: ProviderConnection[] = [];
    if (mode === "provider" && providerId) {
      connectionsToTest = allConnections.filter((c) => c.provider === providerId);
    } else if (mode === "oauth") {
      connectionsToTest = allConnections.filter((c) => getAuthGroup(c.provider, c) === "oauth");
    } else if (mode === "free") {
      connectionsToTest = allConnections.filter((c) => getAuthGroup(c.provider, c) === "free");
    } else if (mode === "apikey") {
      connectionsToTest = allConnections.filter((c) => getAuthGroup(c.provider, c) === "apikey");
    } else if (mode === "compatible") {
      connectionsToTest = allConnections.filter((c) => isCompatibleProvider(c.provider));
    } else if (mode === "all") {
      connectionsToTest = allConnections;
    } else {
      return NextResponse.json(
        { error: "Invalid mode. Use: provider, oauth, free, apikey, compatible, all" },
        { status: 400 },
      );
    }

    if (connectionsToTest.length === 0) {
      return NextResponse.json({
        mode,
        providerId: providerId ?? null,
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        testedAt: new Date().toISOString(),
      });
    }

    const results: TestResult[] = [];
    for (const conn of connectionsToTest) {
      try {
        const data = await testSingleConnection(conn.id) as {
          valid: boolean;
          latencyMs?: number;
          error?: string | null;
          diagnosis?: JsonValue | null;
          statusCode?: number | null;
          testedAt?: string;
        };
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name ?? conn.email ?? conn.provider,
          authType: conn.authType ?? getAuthGroup(conn.provider, conn),
          valid: data.valid,
          latencyMs: data.latencyMs ?? 0,
          error: data.error ?? null,
          diagnosis: data.diagnosis ?? null,
          statusCode: data.statusCode ?? null,
          testedAt: data.testedAt ?? new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name ?? conn.email ?? conn.provider,
          authType: conn.authType ?? getAuthGroup(conn.provider, conn),
          valid: false,
          latencyMs: 0,
          error: message,
          diagnosis: { type: "network_error", source: "local", code: null, message },
          statusCode: null,
          testedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      mode,
      providerId: providerId ?? null,
      results,
      testedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.valid).length,
        failed: results.filter((r) => !r.valid).length,
      },
    });
  } catch (error) {
    console.log("Error in batch test:", error);
    return NextResponse.json({ error: "Batch test failed" }, { status: 500 });
  }
}

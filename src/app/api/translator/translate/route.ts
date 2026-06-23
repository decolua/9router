import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue, ExecutorCredentials } from "open-sse/types/executor.js";
import { detectFormat, getTargetFormat } from "open-sse/services/provider.js";
import { translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { parseModel } from "open-sse/services/model.js";
import { getProviderConnections } from "@/lib/localDb.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getExecutor } from "open-sse/executors/index.js";

type JsonObject = Record<string, JsonValue>;

function asJsonObject(v: JsonValue): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await request.json() as JsonValue;
    if (!asJsonObject(parsed)) {
      return NextResponse.json({ success: false, error: "Step and body required" }, { status: 400 });
    }

    const step = typeof parsed["step"] === "number" ? parsed["step"] : null;
    const bodyVal = parsed["body"] ?? null;

    if (step === null || bodyVal === null) {
      return NextResponse.json({ success: false, error: "Step and body required" }, { status: 400 });
    }

    switch (step) {
      case 1: {
        // Detect provider + formats from 1_req_client.json
        if (!asJsonObject(bodyVal)) {
          return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
        }
        const innerBody = asJsonObject(bodyVal["body"] ?? null) ? bodyVal["body"] as JsonObject : bodyVal;
        const rawModel = innerBody["model"];
        if (typeof rawModel !== "string") {
          return NextResponse.json({ success: false, error: "model must be a string" }, { status: 400 });
        }
        const { provider, model } = parseModel(rawModel);
        const sourceFormat = detectFormat(innerBody);
        const targetFormat = getTargetFormat(provider);
        return NextResponse.json({ success: true, result: { provider, model, sourceFormat, targetFormat } });
      }

      case 2: {
        // source → OpenAI intermediate (mirrors 3_req_openai.json)
        if (!asJsonObject(bodyVal)) {
          return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
        }
        const innerBody = asJsonObject(bodyVal["body"] ?? null) ? bodyVal["body"] as JsonObject : bodyVal;
        const rawModel = innerBody["model"];
        if (typeof rawModel !== "string") {
          return NextResponse.json({ success: false, error: "model must be a string" }, { status: 400 });
        }
        const { provider, model } = parseModel(rawModel);
        const sourceFormat = detectFormat(innerBody);
        const stream = innerBody["stream"] !== false;

        // translateRequest(source, OPENAI) = only the first half
        const result = translateRequest(sourceFormat, FORMATS.OPENAI, model, innerBody, stream, null, provider) as JsonObject;
        delete result["_toolNameMap"];

        return NextResponse.json({ success: true, result: { body: result } });
      }

      case 3: {
        // OpenAI intermediate → target + build URL/headers (mirrors 4_req_target.json)
        if (!asJsonObject(bodyVal)) {
          return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
        }
        const innerBody = asJsonObject(bodyVal["body"] ?? null) ? bodyVal["body"] as JsonObject : bodyVal;
        const provider = typeof parsed["provider"] === "string" ? parsed["provider"] : null;
        const model = typeof parsed["model"] === "string" ? parsed["model"] : null;

        if (!provider || !model) {
          return NextResponse.json({ success: false, error: "provider and model required" }, { status: 400 });
        }

        const targetFormat = getTargetFormat(provider);
        const stream = innerBody["stream"] !== false;

        // translateRequest(OPENAI, target) = second half of pipeline
        const translated = translateRequest(FORMATS.OPENAI, targetFormat, model, innerBody, stream, null, provider) as JsonObject;
        delete translated["_toolNameMap"];

        // Build URL + headers via executor (same as chatCore → executor.execute)
        const connections = await getProviderConnections({ provider });
        const connection = connections.find((c) => c.isActive !== false);

        if (!connection) {
          return NextResponse.json({ success: false, error: `No active connection for provider: ${provider}` }, { status: 400 });
        }

        const psd = typeof connection["providerSpecificData"] === "object" && connection["providerSpecificData"] !== null
          ? connection["providerSpecificData"] as Record<string, string | boolean | undefined>
          : undefined;

        const credentials: ExecutorCredentials = {
          connectionId: (connection as ProviderConnection).id,
          ...(typeof connection["apiKey"] === "string" ? { apiKey: connection["apiKey"] } : {}),
          ...(typeof connection["accessToken"] === "string" ? { accessToken: connection["accessToken"] } : {}),
          ...(typeof psd?.["copilotToken"] === "string" ? { copilotToken: psd["copilotToken"] } : {}),
          ...(psd !== undefined ? { providerSpecificData: psd } : {}),
        };

        const executor = getExecutor(provider);
        const url = executor.buildUrl(model, stream, 0, credentials);
        const headers = executor.buildHeaders(credentials, stream);
        const finalBody = executor.transformRequest(model, translated, stream, credentials);

        return NextResponse.json({ success: true, result: { url, headers, body: finalBody } });
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid step (1-3)" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error in translator:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { detectFormat, getTargetFormat, buildProviderUrl, buildProviderHeaders } from "open-sse/services/provider.js";
import { translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { getProviderConnections } from "@/lib/localDb.js";

export async function POST(request) {
  try {
    const { step, provider, body } = await request.json();

    if (!step || !provider || !body) {
      return NextResponse.json({ success: false, error: "Step, provider, and body required" }, { status: 400 });
    }

    let result;

    switch (step) {
      case 1: {
        // Step 1: Client → Source (detect format)
        // Return format: { timestamp, endpoint, headers, body }
        const actualBody = body.body || body;
        const sourceFormat = detectFormat(actualBody);

        result = {
          timestamp: body.timestamp || new Date().toISOString(),
          endpoint: body.endpoint || "/v1/messages",
          headers: body.headers || {},
          body: actualBody,
          _detectedFormat: sourceFormat,
        };
        break;
      }

      case 2: {
        // Step 2: Source → OpenAI
        // Return format: { timestamp, headers: {}, body }
        const actualBody = body.body || body;
        const sourceFormat = detectFormat(actualBody);
        const targetFormat = FORMATS.OPENAI;
        const model = actualBody.model || "test-model";
        const translated = translateRequest(sourceFormat, targetFormat, model, actualBody, true, null, provider);

        result = {
          timestamp: new Date().toISOString(),
          headers: {},
          body: translated,
        };
        break;
      }

      case 3: {
        // Step 3: OpenAI → Target
        // Return format: { timestamp, body }
        const actualBody = body.body || body;
        const sourceFormat = FORMATS.OPENAI;
        const targetFormat = getTargetFormat(provider);
        const model = actualBody.model || "test-model";
        const translated = translateRequest(sourceFormat, targetFormat, model, actualBody, true, null, provider);

        result = {
          timestamp: new Date().toISOString(),
          body: translated,
        };
        break;
      }

      case 4: {
        // Step 4: Build final request with real URL and headers
        // Return format: { timestamp, url, headers, body }
        const actualBody = body.body || body;
        const model = actualBody.model || "test-model";

        // Get provider credentials
        const connections = await getProviderConnections({ provider });
        const connection = connections.find((c) => c.isActive !== false);

        if (!connection) {
          return NextResponse.json(
            {
              success: false,
              error: `No active connection found for provider: ${provider}`,
            },
            { status: 400 }
          );
        }

        const credentials = {
          apiKey: connection.apiKey,
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          copilotToken: connection.copilotToken,
          projectId: connection.projectId,
          providerSpecificData: connection.providerSpecificData,
        };

        // Build URL and headers
        const url = buildProviderUrl(provider, model, true, { baseUrlIndex: 0 });
        const headers = buildProviderHeaders(provider, credentials, true, actualBody);

        result = {
          timestamp: new Date().toISOString(),
          url: url,
          headers: headers,
          body: actualBody,
        };
        break;
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid step" }, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error translating:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

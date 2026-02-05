import { NextResponse } from "next/server";
import { buildProviderUrl, buildProviderHeaders } from "open-sse/services/provider.js";
import { getProviderConnections } from "@/lib/localDb.js";

export async function POST(request) {
  try {
    const { provider, body } = await request.json();

    if (!provider || !body) {
      return NextResponse.json({ success: false, error: "Provider and body required" }, { status: 400 });
    }

    // Get provider credentials from database
    const connections = await getProviderConnections({ provider });
    const connection = connections.find(c => c.isActive !== false);
    
    if (!connection) {
      return NextResponse.json({ 
        success: false, 
        error: `No active connection found for provider: ${provider}. Available connections: ${connections.length}` 
      }, { status: 400 });
    }

    const credentials = {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      copilotToken: connection.copilotToken,
      projectId: connection.projectId,
      providerSpecificData: connection.providerSpecificData
    };

    // Build URL and headers using provider service
    const url = buildProviderUrl(provider, body.model || "test-model", true, {
      baseUrlIndex: 0,
      baseUrl: connection.providerSpecificData?.baseUrl
    });
    console.log("🚀 ~ POST ~ url:", url)
    const headers = buildProviderHeaders(provider, credentials, true, body);
    console.log("🚀 ~ POST ~ headers:", headers)

    // Send request to provider
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("🚀 ~ POST ~ errorText:", errorText)
      return NextResponse.json({ 
        success: false, 
        error: `Provider error: ${response.status} ${response.statusText}`,
        details: errorText
      }, { status: response.status });
    }

    // Return streaming response
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } catch (error) {
    console.error("Error sending request:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

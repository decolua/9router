import { NextResponse } from "next/server";
import { getProviderConnections, createProviderConnection, getProviderNodeById, getProviderNodes } from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

// GET /api/providers - List all connections
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch {}
    
    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...c,
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, apiKey, name, priority, globalPriority, defaultModel, testStatus } = body;

    // Validation
    const isValidProvider = APIKEY_PROVIDERS[provider] || 
                          isOpenAICompatibleProvider(provider) || 
                          isAnthropicCompatibleProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = null;

    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }

      const existingConnections = await getProviderConnections({ provider });
      if (existingConnections.length > 0) {
        return NextResponse.json({ error: "Only one connection is allowed for this OpenAI Compatible node" }, { status: 400 });
      }

      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }

      const existingConnections = await getProviderConnections({ provider });
      if (existingConnections.length > 0) {
        return NextResponse.json({ error: "Only one connection is allowed for this Anthropic Compatible node" }, { status: 400 });
      }

      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: "apikey",
      name,
      apiKey,
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    // Hide sensitive fields
    const result = { ...newConnection };
    delete result.apiKey;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}

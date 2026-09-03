import { NextResponse } from "next/server";
import { deleteProviderConnectionsByProvider, deleteProviderNode, getProviderConnections, getProviderNodeById, updateProviderConnection, updateProviderNode } from "@/models";
import { canonicalEndpoint, openAIEndpoints } from "../endpointUrls.js";

const BEARER_AUTH = { combined: true, header: "Authorization", scheme: "bearer" };
const ANTHROPIC_AUTH = { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true };

// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, openaiUrl, anthropicUrl, supportsResponses } = body;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
    }

    let transports = node.transports;
    let nextBaseUrl = baseUrl;
    if (node.type === "multi-compatible") {
      const openai = openAIEndpoints(openaiUrl);
      const messagesEndpoint = canonicalEndpoint(anthropicUrl, "/messages");

      if (!openai.chatUrl || !messagesEndpoint) {
        return NextResponse.json({ error: "OpenAI and Anthropic endpoint URLs are required" }, { status: 400 });
      }

      nextBaseUrl = openai.baseUrl;
      transports = [
        { format: "openai", baseUrl: openai.chatUrl, auth: BEARER_AUTH },
        { format: "claude", baseUrl: messagesEndpoint, auth: ANTHROPIC_AUTH },
        ...(supportsResponses ? [{ format: "openai-responses", baseUrl: openai.responsesUrl, auth: BEARER_AUTH }] : []),
      ];
    }

    if (!nextBaseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    let sanitizedBaseUrl = nextBaseUrl.trim();
    
    // Sanitize Base URL for Anthropic Compatible
    if (node.type === "anthropic-compatible") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
    }

    // Sanitize Base URL for Custom Embedding (strip trailing slash and /embeddings)
    if (node.type === "custom-embedding") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
    }

    const updates = {
      name: name.trim(),
      prefix: prefix.trim(),
      baseUrl: sanitizedBaseUrl,
      ...(node.type === "multi-compatible" ? { transports } : {}),
    };

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
    }

    const updated = await updateProviderNode(id, updates);

    const connections = await getProviderConnections({ provider: id });
    await Promise.all(connections.map((connection) => (
      updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...(connection.providerSpecificData || {}),
          prefix: prefix.trim(),
          apiType: node.type === "openai-compatible" ? apiType : node.type === "multi-compatible" ? "chat" : undefined,
          baseUrl: sanitizedBaseUrl,
          nodeName: updated.name,
          ...(node.type === "multi-compatible" ? { transports } : {}),
        }
      })
    )));

    return NextResponse.json({ node: updated });
  } catch (error) {
    console.log("Error updating provider node:", error);
    return NextResponse.json({ error: "Failed to update provider node" }, { status: 500 });
  }
}

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    await deleteProviderConnectionsByProvider(id);
    await deleteProviderNode(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    return NextResponse.json({ error: "Failed to delete provider node" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createProviderNode, getProviderNodes } from "@/models";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX } from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";

export const dynamic = "force-dynamic";

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

const CUSTOM_EMBEDDING_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

// Auto-detect endpoint family from /v1/models response shape.
// Some third-party Anthropic-compatible gateways (e.g. api.xpiki.com) only
// expose /v1/chat/completions even though they market themselves as Anthropic
// compatible. Probe /v1/models once; if the first entry has OpenAI-style id
// (no ":" and no "anthropic_messages" family) we route through chat_completions.
async function detectUseChatCompletions(baseUrl, headers) {
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  try {
    const r = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.data || data?.models || []);
    if (!Array.isArray(list) || list.length === 0) return null;
    // Heuristic: if any model advertises anthropic_messages family, prefer /v1/messages.
    const supportsAnthropic = list.some(m => Array.isArray(m?.endpoint_families) && m.endpoint_families.includes("anthropic_messages"));
    // Heuristic: known OpenAI-shape (no "owned_by" + "object":"model") and no anthropic_messages
    // strongly suggests the gateway is chat-only.
    return !supportsAnthropic;
  } catch {
    return null;
  }
}

// GET /api/provider-nodes - List all provider nodes
export async function GET() {
  try {
    const nodes = await getProviderNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return NextResponse.json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

// POST /api/provider-nodes - Create provider node
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, type } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    // Determine type
    const nodeType = type || "openai-compatible";

    if (nodeType === "openai-compatible") {
      if (!apiType || !["chat", "responses"].includes(apiType)) {
        return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
      }

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim(),
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "custom-embedding") {
      // Strip trailing slash and /embeddings if user pasted full endpoint
      let sanitizedBaseUrl = (baseUrl || CUSTOM_EMBEDDING_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }

      const node = await createProviderNode({
        id: `${CUSTOM_EMBEDDING_PREFIX}${generateId()}`,
        type: "custom-embedding",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      // Sanitize Base URL: remove trailing slash, and remove trailing /messages if user added it
      // This prevents double-appending /messages at runtime
      let sanitizedBaseUrl = (baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }

      // Decide transport: client can pass useChatCompletions explicitly, or we
      // probe /v1/models with the supplied API key (if any) and fall back to
      // unauthenticated probe. If both probes fail we keep Anthropic default.
      let useChatCompletions = body.useChatCompletions === true;
      if (!useChatCompletions) {
        const probeHeaders = { "Content-Type": "application/json" };
        if (typeof body.apiKey === "string" && body.apiKey.trim()) {
          probeHeaders["Authorization"] = `Bearer ${body.apiKey.trim()}`;
        }
        useChatCompletions = (await detectUseChatCompletions(sanitizedBaseUrl, probeHeaders)) === true;
      }

      const node = await createProviderNode({
        id: `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        useChatCompletions,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    console.log("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}

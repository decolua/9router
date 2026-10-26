import { NextResponse } from "next/server";
import { getProviderConnectionById, getProviderNodeById, getCustomModels } from "@/lib/db/index.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getDefaultModel, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  await initTranslators();
  initialized = true;
}

// Dashboard-only chat probe. It bypasses the public gateway API-key check but
// pins execution to the requested connection, so it cannot rotate to another auth.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: { message: "Connection not found" } }, { status: 404 });
    }
    if (connection.isActive === false) {
      return NextResponse.json({ error: { message: "Connection is disabled" } }, { status: 409 });
    }

    const payload = await request.json().catch(() => ({}));
    const providerNode = await getProviderNodeById(connection.provider);
    const providerAlias = providerNode?.prefix || PROVIDER_ID_TO_ALIAS[connection.provider] || connection.provider;
    const customModels = await getCustomModels();
    const fallbackCustomModel = customModels.find((item) =>
      item.providerAlias === providerAlias && (item.kind || item.type || "llm") === "llm"
    )?.id;
    const model = (typeof payload.model === "string" ? payload.model.trim() : "")
      || getDefaultModel(providerAlias)
      || fallbackCustomModel
      || "";
    if (!model) {
      return NextResponse.json({ error: { message: "No chat model is configured for this provider" } }, { status: 400 });
    }

    await ensureInitialized();
    const headers = new Headers({ "Content-Type": "application/json" });
    const userAgent = request.headers.get("user-agent");
    if (userAgent) headers.set("user-agent", userAgent);

    const chatRequest = new Request(new URL("/api/v1/chat/completions", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `${providerAlias}/${model}`,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });

    return await handleChat(chatRequest, null, {
      preferredConnectionId: id,
      skipApiKeyValidation: true,
    });
  } catch (error) {
    console.error("Provider chat test failed:", error);
    return NextResponse.json({ error: { message: error.message || "Chat test failed" } }, { status: 500 });
  }
}

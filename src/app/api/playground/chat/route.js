import { NextResponse } from "next/server";
import { handleChat } from "@/sse/handlers/chat.js";
import { getApiKeys } from "@/lib/db/index.js";
import { initTranslators } from "open-sse/translator/index.js";

export const dynamic = "force-dynamic";

// Fusion-style comparison is only readable a few columns wide, and each model
// costs a full request, so cap the fan-out.
const MAX_MODELS = 4;

let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/** Pull the assistant text out of whatever shape the upstream returned. */
function extractText(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((c) => c?.text || "").join("");
  }
  return "";
}

async function runOne(model, messages, maxTokens, origin, apiKey) {
  const started = Date.now();
  try {
    // Go straight through the same handler /v1/chat/completions uses instead of
    // making a second HTTP hop back into ourselves.
    const req = new Request(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
    });
    const res = await handleChat(req);
    const payload = await res.json().catch(() => ({}));
    const ms = Date.now() - started;

    if (!res.ok) {
      const message = payload?.error?.message || payload?.error || `HTTP ${res.status}`;
      return { model, ok: false, ms, error: String(message).slice(0, 600) };
    }
    return {
      model,
      ok: true,
      ms,
      content: extractText(payload),
      usage: payload?.usage || null,
      finish_reason: payload?.choices?.[0]?.finish_reason || null,
    };
  } catch (error) {
    return { model, ok: false, ms: Date.now() - started, error: String(error?.message || error).slice(0, 600) };
  }
}

// POST /api/playground/chat  { models: [...], messages: [...], max_tokens? }
export async function POST(request) {
  try {
    await ensureInitialized();
    const { models, messages, max_tokens: maxTokens } = await request.json();

    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "models[] required" }, { status: 400 });
    }
    if (models.length > MAX_MODELS) {
      return NextResponse.json({ error: `at most ${MAX_MODELS} models` }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages[] required" }, { status: 400 });
    }

    // handleChat authenticates like any /v1 caller, so borrow a stored key.
    const keys = await getApiKeys().catch(() => []);
    const apiKey = (keys.find((k) => k.isActive) || keys[0])?.key;
    if (!apiKey) {
      return NextResponse.json(
        { error: "No API key configured — create one on the Endpoint & Key page first." },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;
    // One slow model must not hold up the others, and a rejection must not lose
    // the results that did come back.
    const results = await Promise.all(
      models.map((m) => runOne(m, messages, maxTokens, origin, apiKey)),
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.log("Playground chat failed:", error);
    return NextResponse.json({ error: "Playground request failed" }, { status: 500 });
  }
}

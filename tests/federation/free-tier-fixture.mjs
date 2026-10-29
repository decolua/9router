// FED-GAP-04 — deterministic, network-free fixture for the app's genuine
// FREE-TIER completion path.
//
// What "free tier" means here (derived from the app's own catalog, never
// hardcoded): a provider the app classifies `category: "free"` that is
// `noAuth` — i.e. it answers without any credential, which is what
// `src/sse/services/auth.js` turns into a virtual connection
// (`{ id: "noauth", connectionName: "Public", accessToken: "public" }`).
// Providers flagged `requiresVendorClient` are excluded: those (opencode's
// free tier, DF-9ROUTER-1) answer only inside the vendor's own client, so a
// completion through 9router is defined to be impossible there.
//
// The fixture replaces exactly one thing — the OUTBOUND transport to that
// provider's declared endpoints — and nothing else:
//
//   * `globalThis.fetch` is wrapped (the pipeline's own fetch seam: see
//     open-sse/utils/proxyFetch.js, which documents that an untagged stub is
//     respected as-is) and answers the free provider's transport URLs from
//     memory. The rest of the pipeline is untouched and real: model
//     resolution, the API-key gate, free-tier credential injection, request
//     translation, the SSE aggregator and its terminal sentinel.
//   * A request to the same HOST on an UNKNOWN path is refused loudly (501 +
//     `offHostBlocked`), so a transport change can never silently escape to
//     the live endpoint — the run stays network-free by construction.
//   * Any other host falls through to the real fetch (the harness's own
//     loopback traffic is unaffected).
//
// `FIXTURE_TEXT` is split across two SSE delta frames on purpose: a check that
// joins the deltas proves the pipeline re-emitted every frame instead of
// passing one blob through.
export const FIXTURE_TEXT = "e2e-free-tier-ok";
const FIXTURE_FRAMES = ["e2e-free-", "tier-ok"];

const JWT_TTL_SEC = 3600;

// A syntactically real, deterministic-shaped JWT ({alg:HS256}.{exp}.sig) — the
// free provider's executor parses `exp` off it, so it must be 3 base64url
// segments.
function fixtureJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + JWT_TTL_SEC })
  ).toString("base64url");
  return `${header}.${payload}.fixture-signature`;
}

// The single SSE body the free provider's chat endpoint answers with.
export function fixtureSseBody() {
  const frame = (content, finish) => ({
    id: "e2e-free-tier-1",
    object: "chat.completion.chunk",
    model: "mimo-auto",
    choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }],
  });
  const frames = [
    frame(FIXTURE_FRAMES[0], null),
    frame(FIXTURE_FRAMES[1], null),
    frame(null, "stop"),
  ];
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
}

/**
 * Resolve the app's genuinely credentialless free-tier completion target.
 * Everything is read from the app's own sources (no hardcoded provider,
 * model or URL), so the fixture cannot silently point at a provider the app
 * no longer classifies as free.
 *
 * @returns {Promise<{providerId, alias, model, chatUrl, bootstrapUrl}>}
 */
export async function resolveFreeTierTarget() {
  const { FREE_PROVIDERS } = await import("@/shared/constants/providers.js");
  const { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } = await import(
    "open-sse/config/providerModels.js"
  );
  const { PROVIDERS } = await import("open-sse/config/providers.js");
  // The bootstrap endpoint is declared only inside the executor — read it from
  // there instead of duplicating the URL.
  const { __test__ } = await import("open-sse/executors/mimo-free.js");

  const noAuthFree = Object.keys(FREE_PROVIDERS).filter(
    (id) => FREE_PROVIDERS[id].noAuth && !FREE_PROVIDERS[id].requiresVendorClient
  );
  const withModels = noAuthFree.filter((id) => {
    const alias = PROVIDER_ID_TO_ALIAS[id] || id;
    return (PROVIDER_MODELS[alias] || []).length > 0;
  });
  if (withModels.length === 0) {
    throw new Error(
      "free-tier fixture: no credentialless free provider with registered models " +
        `(noAuth free providers: ${noAuthFree.join(", ") || "none"})`
    );
  }
  const providerId = withModels[0];
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const model = `${alias}/${PROVIDER_MODELS[alias][0].id}`;
  const chatUrl = PROVIDERS[providerId]?.baseUrl || null;
  const bootstrapUrl = __test__.BOOTSTRAP_URL || null;
  if (!chatUrl || !bootstrapUrl) {
    throw new Error(`free-tier fixture: ${providerId} has no declared transport URL`);
  }
  return { providerId, alias, model, chatUrl, bootstrapUrl };
}

/**
 * Install the fixture on process-wide `globalThis.fetch`.
 *
 * `passthrough` MUST be the NATIVE fetch captured before any app module ran.
 * The app's proxy layer (open-sse/utils/proxyFetch.js) resolves its "inner"
 * fetch at CALL time by unwrapping tagged wrappers and otherwise trusting the
 * current `globalThis.fetch` — i.e. it will happily adopt this (untagged)
 * fixture wrapper as its inner fetch. A passthrough pointing back at that
 * patched wrapper therefore closes a cycle:
 *   fixture → patchedFetch → proxyAwareFetch → fixture → …
 * which dies as `RangeError: Maximum call stack size exceeded` in whatever
 * unrelated call happens to use fetch (in the E2E: the edge's replication
 * poll). The tagged-wrapper check below turns that trap into a loud error
 * instead of a recursion.
 *
 * @param {{chatUrl: string, bootstrapUrl: string}} target from resolveFreeTierTarget()
 * @param {{passthrough?: typeof fetch}} [options]
 * @returns {{state: object, uninstall: () => void}}
 */
export function installFreeTierFixture(target, { passthrough = globalThis.fetch } = {}) {
  const realFetch = passthrough;
  if (typeof realFetch !== "function") {
    throw new Error("free-tier fixture: no fetch to pass through to");
  }
  if (realFetch[Symbol.for("9router.proxyFetch.patched")] === true) {
    throw new Error(
      "free-tier fixture: passthrough is the app's patched fetch wrapper — pass the native " +
        "fetch captured before any app module loaded, or proxyAwareFetch will recurse into the fixture"
    );
  }
  const host = new URL(target.chatUrl).host;
  const state = {
    bootstrapRequests: 0,
    chatRequests: 0,
    // Same host, undeclared path: a fixture MISS. Never falls through to the
    // network — the run must not be able to reach the live endpoint.
    offTargetBlocked: 0,
    lastChatRequest: null,
  };

  const record = (url, init) => {
    let parsed = null;
    if (init?.body) {
      try {
        parsed = JSON.parse(String(init.body));
      } catch {
        parsed = null;
      }
    }
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    return {
      url,
      model: parsed?.model ?? null,
      stream: parsed?.stream === true,
      messageCount: messages.length,
      systemMessages: messages.filter((m) => m?.role === "system").length,
    };
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === target.bootstrapUrl) {
      state.bootstrapRequests += 1;
      return new Response(JSON.stringify({ jwt: fixtureJwt() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u === target.chatUrl) {
      state.chatRequests += 1;
      state.lastChatRequest = record(u, init);
      return new Response(fixtureSseBody(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    let sameHost = false;
    try {
      sameHost = new URL(u).host === host;
    } catch {
      sameHost = false;
    }
    if (sameHost) {
      state.offTargetBlocked += 1;
      return new Response(
        JSON.stringify({
          error: {
            message:
              `free-tier fixture MISS for ${u}: the free provider's transport changed. ` +
              `Update tests/federation/free-tier-fixture.mjs instead of letting the test ` +
              `reach the live endpoint.`,
          },
        }),
        { status: 501, headers: { "content-type": "application/json" } }
      );
    }
    return realFetch(url, init);
  };

  return {
    state,
    uninstall() {
      globalThis.fetch = realFetch;
    },
  };
}

/** Concatenate the assistant deltas of an SSE body (terminal sentinel excluded). */
export function joinDeltaContent(sseText) {
  return String(sseText || "")
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim())
    .filter((f) => f && f !== "[DONE]")
    .map((f) => {
      try {
        return JSON.parse(f);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((f) => f?.choices?.[0]?.delta?.content || "")
    .join("");
}

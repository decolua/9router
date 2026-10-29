// ChatGPT Web image generation (picture_v2 flow, in-page).
//
// Drives ChatGPT's own image pipeline from inside the logged-in page: the
// first-party bridge solves Sentinel/PoW, then the picture_v2 prepare +
// conversation endpoints run the generation, the conversation document is
// polled until the image_gen tool record lands, and the generated file is
// downloaded in-page as base64.

import { ensureFirstPartyBridge, FIRST_PARTY_BRIDGE_KEY } from "./firstParty.js";

const MAX_SSE_BYTES = 16 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 32 * 1024 * 1024;
const POLL_INITIAL_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 240000;
const CONTENT_POLICY_RE =
  /(content policy|violat(?:es|ed|ion)|can't create|cannot create|i can't generate|i cannot generate|not able to create|unable to create|safety)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ChatGptWebImageError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ChatGptWebImageError";
    if (status) this.status = status;
  }
}

/** Sentinel headers for the image endpoints, via the page's own challenge solver. */
async function sentinelHeaders(page) {
  return page.evaluate(async (bridgeKey) => {
    const root = globalThis;
    const bridge = root[bridgeKey];
    const legacyReady = [
      bridge?.finalizeRequirements,
      bridge?.proofManager?.getEnforcementToken,
      bridge?.turnstileManager?.getEnforcementToken,
      bridge?.buildSentinelHeaders,
    ].every((member) => typeof member === "function");
    const resolverReady =
      typeof bridge?.resolveIntegrity === "function" &&
      typeof bridge?.requestClient?.safePost === "function";
    if (!legacyReady && !resolverReady) {
      throw new Error("ChatGPT Web first-party challenge bridge is incomplete");
    }
    if (resolverReady) {
      const integrity = await bridge.resolveIntegrity(async (proof) =>
        bridge.requestClient.safePost("/sentinel/chat-requirements/prepare", {
          requestBody: { p: proof },
        })
      );
      return { ...(integrity?.headers ?? {}) };
    }
    const requirements = await bridge.finalizeRequirements(false, "none");
    const [proof, turnstile] = await Promise.all([
      bridge.proofManager.getEnforcementToken(requirements, { forceSync: true }),
      bridge.turnstileManager.getEnforcementToken(requirements),
    ]);
    return bridge.buildSentinelHeaders(requirements, turnstile, proof, null, null, null);
  }, FIRST_PARTY_BRIDGE_KEY);
}

/** The page's own session access token (Authorization for /backend-api calls). */
async function pageAccessToken(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    if (!response.ok) throw new Error("ChatGPT Web browser session is unavailable");
    const session = await response.json();
    if (typeof session?.accessToken !== "string" || !session.accessToken) {
      throw new Error("ChatGPT Web browser session has no access token");
    }
    return session.accessToken;
  });
}

/** Run the picture_v2 flow inside the page and return { conversationId, fileIds, sedimentIds }. */
async function runImageConversation(page, prompt, { sizeHint, signal }) {
  const headers = await sentinelHeaders(page);
  const accessToken = await pageAccessToken(page);

  return page.evaluate(
    async ({ accessToken, headers, prompt, sizeHint, maxBytes }) => {
      const authHeaders = { ...headers, Authorization: `Bearer ${accessToken}` };

      const readBody = async (response, limit) => {
        const reader = response.body?.getReader();
        if (!reader) return "";
        const decoder = new TextDecoder();
        const chunks = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > limit) {
              await reader.cancel().catch(() => {});
              throw new Error(`response exceeded ${limit} bytes`);
            }
            chunks.push(decoder.decode(value, { stream: true }));
          }
          chunks.push(decoder.decode());
        } finally {
          try {
            reader.releaseLock();
          } catch {}
        }
        return chunks.join("");
      };
      const fetchWithTimeout = async (url, options, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      };

      // 1. prepare → conduit token
      const prepareResponse = await fetchWithTimeout("/backend-api/f/conversation/prepare", {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "next", fork_from_shared_post: false, parent_message_id: crypto.randomUUID(), model: "auto", client_prepare_state: "success", timezone_offset_min: new Date().getTimezoneOffset(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, conversation_mode: { kind: "primary_assistant" }, system_hints: ["picture_v2"], partial_query: { id: crypto.randomUUID(), author: { role: "user" }, content: { content_type: "text", parts: [prompt] } }, supports_buffering: true, supported_encodings: ["v1"], client_contextual_info: { app_name: "chatgpt.com" } }),
      }, 60000);
      if (!prepareResponse.ok) {
        throw new Error(`prepare failed with status ${prepareResponse.status}`);
      }
      const prepareJson = await prepareResponse.json();
      const conduitToken = prepareJson.conduit_token || "";

      // 2. conversation SSE — run the generation. The stream can stay open for
      // the whole generation (progress keepalives), so it is read under a hard
      // deadline: capture the conversation id + any ids seen so far, then abort
      // and let the conversation-document poll below finish the job.
      const sseDeadlineMs = 90000;
      const text = sizeHint ? `${prompt} (aspect ratio ${sizeHint})` : prompt;
      const sseController = new AbortController();
      const sseTimer = setTimeout(() => sseController.abort(), sseDeadlineMs);
      let sseText = "";
      try {
        const conversationResponse = await fetch("/backend-api/f/conversation", {
          method: "POST",
          credentials: "include",
          signal: sseController.signal,
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-Conduit-Token": conduitToken,
            "X-Oai-Turn-Trace-Id": crypto.randomUUID(),
          },
          body: JSON.stringify({ action: "next", messages: [{ id: crypto.randomUUID(), author: { role: "user" }, create_time: Date.now() / 1000, content: { content_type: "text", parts: [text] }, metadata: { developer_mode_connector_ids: [], selected_github_repos: [], selected_all_github_repos: false, system_hints: ["picture_v2"], serialization_metadata: { custom_symbol_offsets: [] } } }], parent_message_id: crypto.randomUUID(), model: "auto", client_prepare_state: "sent", timezone_offset_min: new Date().getTimezoneOffset(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, conversation_mode: { kind: "primary_assistant" }, enable_message_followups: true, system_hints: ["picture_v2"], supports_buffering: true, supported_encodings: ["v1"], client_contextual_info: { is_dark_mode: false, time_since_loaded: 1200, page_height: 1072, page_width: 1724, pixel_ratio: 1.2, screen_height: 1440, screen_width: 2560, app_name: "chatgpt.com" }, paragen_cot_summary_display_override: "allow", force_parallel_switch: "auto" }),
        });
        if (!conversationResponse.ok) {
          const status = conversationResponse.status;
          await conversationResponse.body?.cancel().catch(() => {});
          throw new Error(`conversation failed with status ${status}`);
        }
        // Early-exit read: stop as soon as the deadline fires (the abort
        // rejects the pending read) — partial text is enough for id scraping.
        try {
          sseText = await readBody(conversationResponse, maxBytes);
        } catch (error) {
          if (!sseController.signal.aborted && !/exceeded/.test(String(error?.message || ""))) {
            throw error;
          }
        }
      } finally {
        clearTimeout(sseTimer);
        sseController.abort();
      }

      // 3. extract conversation id + any ids already visible in the stream
      const conversationId = (sseText.match(/"conversation_id"\s*:\s*"([0-9a-f-]{36})"/) || [])[1] || "";
      const fileIds = [];
      const sedimentIds = [];
      const isInvalidFileId = (id) => !id || id === "file_upload" || id.startsWith("file_upload");
      const addUnique = (list, value) => {
        if (value && !isInvalidFileId(value) && !list.includes(value)) list.push(value);
      };
      for (const match of sseText.matchAll(/file-service:\/\/([A-Za-z0-9_-]+)/g)) addUnique(fileIds, match[1]);
      for (const match of sseText.matchAll(/\bfile_00000000[a-f0-9]{24}\b/g)) addUnique(fileIds, match[0]);
      for (const match of sseText.matchAll(/\bfile-[A-Za-z0-9_-]{16,}\b/g)) addUnique(fileIds, match[0]);
      for (const match of sseText.matchAll(/sediment:\/\/([A-Za-z0-9_-]+)/g)) addUnique(sedimentIds, match[1]);
      return { conversationId, fileIds, sedimentIds };
    },
    { accessToken, headers, prompt, sizeHint, maxBytes: MAX_SSE_BYTES }
  );
}

/** Poll the conversation document until the image_gen tool record lands. */
async function pollConversationImages(page, accessToken, conversationId, initial, { signal, log }) {
  const started = Date.now();
  const fileIds = [...initial.fileIds];
  const sedimentIds = [...initial.sedimentIds];

  await sleep(POLL_INITIAL_WAIT_MS);
  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new ChatGptWebImageError("ChatGPT image generation timed out", 504);
    }

    const polled = await page.evaluate(
      async ({ accessToken, conversationId, maxBytes }) => {
        const fetchWithTimeout = async (url, options, timeoutMs) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetch(url, { ...options, signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        };
        const response = await fetchWithTimeout(`/backend-api/conversation/${conversationId}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        }, 30000);
        if (!response.ok) return { status: response.status };
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (declared > maxBytes) return { status: 413 };
        const text = await response.text();
        if (text.length > maxBytes) return { status: 413 };
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return { status: 502 };
        }

        const fileIds = [];
        const sedimentIds = [];
        const isInvalidFileId = (id) => !id || id === "file_upload" || id.startsWith("file_upload");
        const addUnique = (list, value) => {
          if (value && !isInvalidFileId(value) && !list.includes(value)) list.push(value);
        };
        const hasAssetPointer = (value) => {
          if (Array.isArray(value)) return value.some(hasAssetPointer);
          if (value && typeof value === "object") {
            if (String(value.content_type || "") === "image_asset_pointer") return true;
            const pointer = String(value.asset_pointer || "");
            if (pointer.startsWith("file-service://") || pointer.startsWith("sediment://")) return true;
            return Object.values(value).some(hasAssetPointer);
          }
          return false;
        };
        const collectIds = (value) => {
          if (typeof value === "string") {
            for (const match of value.matchAll(/file-service:\/\/([A-Za-z0-9_-]+)/g)) addUnique(fileIds, match[1]);
            for (const match of value.matchAll(/\bfile_00000000[a-f0-9]{24}\b/g)) addUnique(fileIds, match[0]);
            for (const match of value.matchAll(/\bfile-[A-Za-z0-9_-]{16,}\b/g)) addUnique(fileIds, match[0]);
            for (const match of value.matchAll(/sediment:\/\/([A-Za-z0-9_-]+)/g)) addUnique(sedimentIds, match[1]);
            return;
          }
          if (Array.isArray(value)) {
            value.forEach(collectIds);
            return;
          }
          if (value && typeof value === "object") {
            Object.values(value).forEach(collectIds);
          }
        };

        let errorText = "";
        const mapping = data.mapping || {};
        for (const node of Object.values(mapping)) {
          const message = (node || {}).message || {};
          const role = String(message.author?.role || "").toLowerCase();
          if (role !== "tool" && role !== "assistant") continue;
          const metadata = message.metadata || {};
          const isImageGen = metadata.async_task_type === "image_gen";
          const hasPointer = hasAssetPointer(message.content) || hasAssetPointer(metadata);
          if (role === "assistant" && !isImageGen && !hasPointer) continue;
          collectIds({ content: message.content, metadata });
          if (role === "assistant" && metadata.is_error && message.content?.content_type === "text") {
            const parts = Array.isArray(message.content.parts) ? message.content.parts : [];
            const joined = parts.filter((p) => typeof p === "string").join("");
            if (joined) errorText = joined.slice(0, 300);
          }
        }
        return { status: 200, fileIds, sedimentIds, errorText };
      },
      { accessToken, conversationId, maxBytes: MAX_CONVERSATION_BYTES }
    );

    if (polled.status !== 200) {
      log?.debug?.("CGPT-WEB-IMG", `conversation poll status ${polled.status}, retrying`);
    } else {
      for (const id of polled.fileIds) if (!fileIds.includes(id)) fileIds.push(id);
      for (const id of polled.sedimentIds) if (!sedimentIds.includes(id)) sedimentIds.push(id);
      const validFileIds = fileIds.filter((id) => id && id !== "file_upload" && !id.startsWith("file_upload"));
      if (validFileIds.length > 0 || sedimentIds.length > 0) {
        return { fileIds: validFileIds, sedimentIds };
      }
      if (polled.errorText && CONTENT_POLICY_RE.test(polled.errorText)) {
        throw new ChatGptWebImageError(
          `ChatGPT refused the image request: ${polled.errorText}`,
          400
        );
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Resolve one generated id into { b64, mime } via the file/attachment download endpoints. */
async function downloadGeneratedImage(page, accessToken, conversationId, { fileIds, sedimentIds }) {
  for (const fileId of fileIds) {
    const result = await page.evaluate(
      async ({ accessToken, fileId }) => {
        const fetchWithTimeout = async (url, options, timeoutMs) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetch(url, { ...options, signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        };
        const response = await fetchWithTimeout(`/backend-api/files/${fileId}/download`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        }, 60000);
        if (!response.ok) return { status: response.status };
        const data = await response.json();
        const url = data.download_url || data.url || "";
        if (!url) return { status: 404 };
        const binary = await fetchWithTimeout(url, {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
        }, 90000);
        if (!binary.ok) return { status: binary.status };
        const blob = await binary.blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) {
          s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        return { status: 200, mime: blob.type || "image/png", b64: btoa(s) };
      },
      { accessToken, fileId }
    );
    if (result.status === 200 && result.b64) {
      return { b64: result.b64, mime: result.mime };
    }
  }
  for (const sedimentId of sedimentIds) {
    const result = await page.evaluate(
      async ({ accessToken, conversationId, sedimentId }) => {
        const fetchWithTimeout = async (url, options, timeoutMs) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetch(url, { ...options, signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        };
        const response = await fetchWithTimeout(
          `/backend-api/conversation/${conversationId}/attachment/${sedimentId}/download`,
          {
            credentials: "include",
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          },
          60000
        );
        if (!response.ok) return { status: response.status };
        const data = await response.json();
        const url = data.download_url || data.url || "";
        if (!url) return { status: 404 };
        const binary = await fetchWithTimeout(url, {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
        }, 90000);
        if (!binary.ok) return { status: binary.status };
        const blob = await binary.blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) {
          s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        return { status: 200, mime: blob.type || "image/png", b64: btoa(s) };
      },
      { accessToken, conversationId, sedimentId }
    );
    if (result.status === 200 && result.b64) {
      return { b64: result.b64, mime: result.mime };
    }
  }
  throw new ChatGptWebImageError("ChatGPT image generation produced no downloadable file", 502);
}

/**
 * Generate one image inside a logged-in ChatGPT page and return base64 bytes.
 */
export async function generateChatGptWebImage(page, { prompt, sizeHint, signal, log }) {
  await ensureFirstPartyBridge(page);
  if (signal?.aborted) throw new Error("Request aborted");
  const initial = await runImageConversation(page, prompt, { sizeHint, signal });
  const validInitialFileIds = initial.fileIds.filter((id) => id && id !== "file_upload" && !id.startsWith("file_upload"));
  const hasInitial = validInitialFileIds.length > 0 || initial.sedimentIds.length > 0;
  if (!initial.conversationId && !hasInitial) {
    throw new ChatGptWebImageError("ChatGPT image conversation produced no conversation id", 502);
  }
  const accessToken = await pageAccessToken(page);
  const ids = hasInitial
    ? { ...initial, fileIds: validInitialFileIds }
    : await pollConversationImages(page, accessToken, initial.conversationId, initial, { signal, log });
  return downloadGeneratedImage(page, accessToken, initial.conversationId, ids);
}

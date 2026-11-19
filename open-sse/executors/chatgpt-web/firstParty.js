// ChatGPT Web first-party in-page request executor.
//
// Lets ChatGPT's own loaded page module execute Sentinel, Turnstile,
// proof-of-work, cookies, and conduit preparation: we discover the page's own
// webpack exports by semantic markers (minified names are deliberately not
// pinned), bridge them onto `window`, and drive the request path through them.
// The hot path never touches the composer, model picker, or bearer tokens.

const CHATGPT_ORIGIN = "https://chatgpt.com";
const CHATGPT_ASSET_PATH_RE =
  /^\/(?:cdn|unauth-mweb|auth-mweb)\/(?:assets|scripts)\/[A-Za-z0-9._-]+\.js$/;
const OAI_UPLOAD_HOST_RE = /(?:^|\.)oaiusercontent\.com$/i;
const FIRST_PARTY_BRIDGE_KEY = "__ninerouterChatGptFirstPartyV1";
export { FIRST_PARTY_BRIDGE_KEY };
const FIRST_PARTY_ABORT_KEY = "__ninerouterChatGptAbortV1";
const FIRST_PARTY_REQUEST_KEY = "__ninerouterChatGptRequestV1";
const MAX_ASSET_SOURCE_BYTES = 24 * 1024 * 1024;
const MAX_CONVERSATION_RESPONSE_BYTES = 16 * 1024 * 1024;
const ASSET_FETCH_TIMEOUT_MS = 20000;
const MAX_DISCOVERY_ASSETS = 512;
const MODULE_DISCOVERY_TIMEOUT_MS = 15000;
const MODULE_DISCOVERY_POLL_MS = 250;

const contractCache = new Map();
const pageRequestTails = new WeakMap();
let lastKnownModuleAssetUrl = null;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportedName(source, localName) {
  const exportStart = source.lastIndexOf("export{");
  if (exportStart < 0) return null;
  const exportBlock = source.slice(exportStart + "export{".length);
  const match = exportBlock.match(
    new RegExp(`(?:^|,)${escapeRegExp(localName)} as ([A-Za-z_$][\\w$]*)`)
  );
  return match?.[1] ?? null;
}

/**
 * Discover the public exports used by ChatGPT's own request path from semantic
 * markers. Minified local/export names are deliberately not pinned and may
 * change on every deployment.
 */
export function parseChatGptWebFirstPartyModuleContract(source) {
  const finalizeLocal = source.match(
    /function ([A-Za-z_$][\w$]*)\(e=!1,t=`none`(?:,n=[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)?\)\{return [A-Za-z_$][\w$]*\(`finalized`,e,t(?:,n)?\)\}/
  )?.[1];
  const enforcement = source.match(
    /Promise\.all\(\[([A-Za-z_$][\w$]*)\.getEnforcementToken\(t,\{forceSync:!0\}\),([A-Za-z_$][\w$]*)\.getEnforcementToken\(t\)\]\)/
  );
  const requestClientLocal = source.match(
    /([A-Za-z_$][\w$]*)\.safePost\(`\/sentinel\/chat-requirements\/prepare`/
  )?.[1];
  const headerBuilderLocal = source.match(
    /function ([A-Za-z_$][\w$]*)\(e,t,n,r,i,a\)\{let o=\{\};return e\?\.token\?o\[`OpenAI-Sentinel-Chat-Requirements-Token`\]/
  )?.[1];
  const proofLocal = enforcement?.[1];
  const turnstileLocal = enforcement?.[2];
  if (
    !finalizeLocal ||
    !proofLocal ||
    !turnstileLocal ||
    !requestClientLocal ||
    !headerBuilderLocal
  ) {
    throw new Error("ChatGPT Web first-party module contract was not found");
  }

  const contract = {
    finalizeRequirements: exportedName(source, finalizeLocal),
    proofManager: exportedName(source, proofLocal),
    turnstileManager: exportedName(source, turnstileLocal),
    requestClient: exportedName(source, requestClientLocal),
    buildSentinelHeaders: exportedName(source, headerBuilderLocal),
  };
  if (Object.values(contract).some((value) => value === null)) {
    throw new Error("ChatGPT Web first-party module contract exports were not found");
  }
  return contract;
}

function parsePartialChatGptWebFirstPartyModuleContract(source) {
  const result = {};

  const finalizeLocal =
    source.match(
      /function ([A-Za-z_$][\w$]*)\(e=!1,t=`none`(?:,n=[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)?\)\{return [A-Za-z_$][\w$]*\(`finalized`,e,t(?:,n)?\)\}/
    )?.[1] ??
    source.match(/finalizeChatRequirements\s*:\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (finalizeLocal) result.finalizeRequirements = exportedName(source, finalizeLocal) ?? finalizeLocal;

  const enforcement = source.match(
    /Promise\.all\(\[([A-Za-z_$][\w$]*)\.getEnforcementToken\(t,\{forceSync:!0\}\),([A-Za-z_$][\w$]*)\.getEnforcementToken\(t\)\]\)/
  );
  const proofLocal =
    enforcement?.[1] ??
    source.match(/([A-Za-z_$][\w$]*)\.getEnforcementToken\([^)]*forceSync\s*:\s*!0/)?.[1];
  const turnstileLocal = enforcement?.[2];
  if (proofLocal) result.proofManager = exportedName(source, proofLocal) ?? proofLocal;
  if (turnstileLocal) result.turnstileManager = exportedName(source, turnstileLocal) ?? turnstileLocal;

  const requestClientLocal =
    source.match(/([A-Za-z_$][\w$]*)\.safePost\(`\/sentinel\/chat-requirements\/prepare`/)?.[1] ??
    source.match(
      /([A-Za-z_$][\w$]*)\.(?:safePost|post)\([`"]\/sentinel\/chat-requirements\/prepare[`"]/
    )?.[1];
  if (requestClientLocal) {
    result.requestClient = exportedName(source, requestClientLocal) ?? requestClientLocal;
  }

  const headerBuilderLocal =
    source.match(
      /function ([A-Za-z_$][\w$]*)\(e,t,n,r,i,a\)\{let o=\{\};return e\?\.token\?o\[`OpenAI-Sentinel-Chat-Requirements-Token`\]/
    )?.[1] ??
    source.match(
      /([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,1200}OpenAI-Sentinel-Chat-Requirements-Token/
    )?.[1];
  if (headerBuilderLocal) {
    result.buildSentinelHeaders = exportedName(source, headerBuilderLocal) ?? headerBuilderLocal;
  }

  const integrityModule = source.match(
    /(?:^|\}\),)([A-Za-z0-9_$]+):\(function\(e,t,n\)\{n\.d\(t,\{([^}]+)\}\);[\s\S]{0,1800}?async function ([A-Za-z_$][\w$]*)\(e\)\{let t=[A-Za-z_$][\w$]*\(\),n=[A-Za-z_$][\w$]*\(await e\(t\)\)/
  );
  if (integrityModule) {
    const [, moduleId, exportMap, resolveIntegrityLocal] = integrityModule;
    const resolveIntegrityExport = exportMap.match(
      new RegExp(
        `(?:^|,)\\s*([A-Za-z_$][\\w$]*):\\(\\)=>${escapeRegExp(resolveIntegrityLocal)}(?:,|$)`
      )
    )?.[1];
    if (resolveIntegrityExport) {
      result.resolveIntegrity = resolveIntegrityExport;
      result.resolveIntegrityModule = moduleId;
    }
  }

  return result;
}

function requireChatGptAssetUrl(value) {
  const url = new URL(value);
  if (url.origin !== CHATGPT_ORIGIN || !CHATGPT_ASSET_PATH_RE.test(url.pathname)) {
    throw new Error("ChatGPT Web exposed an invalid first-party asset URL");
  }
  return url.toString();
}

export function collectChatGptWebFirstPartyAssetCandidates(resourceUrls, modulePreloadUrls) {
  return Array.from(new Set([...resourceUrls, ...modulePreloadUrls])).filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === CHATGPT_ORIGIN && CHATGPT_ASSET_PATH_RE.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}

/** Find first-party chunks referenced by an already-loaded ChatGPT module. */
export function extractChatGptWebFirstPartyAssetReferences(source, parentAssetUrl) {
  const references = [];
  const seen = new Set();
  const pattern = /["']\.\/([A-Za-z0-9_-]+\.js)["']/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let assetUrl;
    try {
      assetUrl = requireChatGptAssetUrl(new URL(`./${match[1]}`, parentAssetUrl).toString());
    } catch {
      continue;
    }
    if (!seen.has(assetUrl)) {
      seen.add(assetUrl);
      references.push(assetUrl);
    }
  }
  return references;
}

async function readAssetSource(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("ChatGPT Web first-party asset could not be loaded");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_ASSET_SOURCE_BYTES) {
      throw new Error("ChatGPT Web first-party asset exceeded the size limit");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_SOURCE_BYTES) {
      throw new Error("ChatGPT Web first-party asset exceeded the size limit");
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

function discoveryError(error, fallback) {
  return error instanceof Error ? error : new Error(fallback);
}

async function collectPageAssetCandidates(page) {
  const sources = await page.evaluate(() => ({
    modulePreloadUrls: Array.from(
      document.querySelectorAll('link[rel="modulepreload"][href]'),
      (link) => link.href
    ),
    resourceUrls: performance.getEntriesByType("resource").map((entry) => entry.name),
  }));
  return collectChatGptWebFirstPartyAssetCandidates(sources.resourceUrls, sources.modulePreloadUrls);
}

async function inspectFirstPartyAsset(candidate, state) {
  let assetUrl;
  try {
    assetUrl = requireChatGptAssetUrl(candidate);
  } catch (error) {
    state.lastError = discoveryError(error, "Invalid ChatGPT asset URL");
    return null;
  }
  if (state.visited.has(assetUrl)) return null;
  state.visited.add(assetUrl);

  const cached = contractCache.get(assetUrl);
  if (cached) {
    try {
      return { assetUrl, contract: await cached };
    } catch {
      contractCache.delete(assetUrl);
    }
  }

  let source;
  try {
    source = await readAssetSource(assetUrl);
  } catch (error) {
    state.lastError = discoveryError(error, "ChatGPT asset discovery failed");
    return null;
  }
  try {
    const contract = parseChatGptWebFirstPartyModuleContract(source);
    contractCache.set(assetUrl, Promise.resolve(contract));
    lastKnownModuleAssetUrl = assetUrl;
    return { assetUrl, contract };
  } catch (error) {
    const partial = parsePartialChatGptWebFirstPartyModuleContract(source);
    for (const [key, value] of Object.entries(partial)) {
      if (!state.partial[key]) {
        state.partial[key] = value;
        state.symbolAssetUrls[key] = assetUrl;
      }
    }

    if (
      state.partial.requestClient &&
      ((state.partial.resolveIntegrity && state.partial.resolveIntegrityModule) ||
        (state.partial.finalizeRequirements &&
          state.partial.proofManager &&
          state.partial.buildSentinelHeaders))
    ) {
      const contract = {
        finalizeRequirements: state.partial.finalizeRequirements ?? "",
        proofManager: state.partial.proofManager ?? "",
        turnstileManager: state.partial.turnstileManager ?? state.partial.proofManager ?? "",
        requestClient: state.partial.requestClient,
        buildSentinelHeaders: state.partial.buildSentinelHeaders ?? "",
        ...(state.partial.resolveIntegrity
          ? {
              resolveIntegrity: state.partial.resolveIntegrity,
              resolveIntegrityModule: state.partial.resolveIntegrityModule,
            }
          : {}),
      };
      const primaryAssetUrl = state.symbolAssetUrls.finalizeRequirements ?? assetUrl;
      lastKnownModuleAssetUrl = primaryAssetUrl;
      return { assetUrl: primaryAssetUrl, contract };
    }

    const found = Object.keys(state.partial);
    state.lastError = found.length
      ? new Error(`ChatGPT module discovery incomplete: found ${found.join(", ")}`)
      : discoveryError(error, "ChatGPT module discovery failed");
    const references = extractChatGptWebFirstPartyAssetReferences(source, assetUrl);
    state.queue.push(...references.filter((reference) => !state.visited.has(reference)));
    return null;
  }
}

async function scanQueuedFirstPartyAssets(state) {
  while (state.index < state.queue.length && state.visited.size < MAX_DISCOVERY_ASSETS) {
    const candidate = state.queue[state.index];
    state.index += 1;
    const result = await inspectFirstPartyAsset(candidate, state);
    if (result) return result;
  }
  return null;
}

async function discoverFirstPartyModule(page) {
  const state = {
    queue: [...(lastKnownModuleAssetUrl ? [lastKnownModuleAssetUrl] : [])],
    visited: new Set(),
    index: 0,
    lastError: null,
    partial: {},
    symbolAssetUrls: {},
  };
  const deadline = Date.now() + MODULE_DISCOVERY_TIMEOUT_MS;

  while (Date.now() <= deadline && state.visited.size < MAX_DISCOVERY_ASSETS) {
    state.queue.push(...(await collectPageAssetCandidates(page)));
    const result = await scanQueuedFirstPartyAssets(state);
    if (result) return result;
    if (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MODULE_DISCOVERY_POLL_MS));
    }
  }
  throw new Error("ChatGPT Web first-party request module was not loaded");
}

function buildBridgeModuleSource(assetUrl, contract) {
  const urlLiteral = JSON.stringify(requireChatGptAssetUrl(assetUrl));
  const contractLiteral = JSON.stringify(contract);
  const keyLiteral = JSON.stringify(FIRST_PARTY_BRIDGE_KEY);
  if (contract.resolveIntegrity && contract.resolveIntegrityModule) {
    return [
      `import * as upstream from ${urlLiteral};`,
      `const names = ${contractLiteral};`,
      `const modules = upstream.__webpack_modules__;`,
      `const factory = modules?.[names.resolveIntegrityModule];`,
      `if (typeof factory !== "function") throw new Error("ChatGPT integrity module factory is unavailable");`,
      `const exports = {};`,
      `const requireShim = id => {`,
      // "TI" and "DD" are entropy-source helpers used by the integrity
      // resolver's fingerprint array — both boil down to a uuid call.
      `if (id === "TI" || id === "DD") return { a: () => crypto.randomUUID() };`,
      `const real = modules[id];`,
      `if (typeof real === "function") {`,
      `const nested = {};`,
      `real({}, nested, requireShim);`,
      `return nested;`,
      `}`,
      `throw new Error("Unsupported ChatGPT integrity dependency: " + id);`,
      `};`,
      `requireShim.d = (target, definitions) => {`,
      `for (const [name, getter] of Object.entries(definitions)) {`,
      `Object.defineProperty(target, name, { enumerable: true, get: getter });`,
      `}`,
      `};`,
      `factory({}, exports, requireShim);`,
      `const resolveIntegrity = exports[names.resolveIntegrity];`,
      `if (typeof resolveIntegrity !== "function") throw new Error("ChatGPT integrity resolver is unavailable");`,
      `const sessionPromise = fetch("/api/auth/session", { credentials: "include" }).then(async response => {`,
      `if (!response.ok) throw new Error("ChatGPT browser session is unavailable");`,
      `return response.json();`,
      `});`,
      `const requestClient = {`,
      `safePost: async (path, options = {}) => {`,
      `const headers = new Headers(options.additionalHeaders || {});`,
      `const session = await sessionPromise;`,
      `if (typeof session?.accessToken === "string" && session.accessToken) {`,
      `headers.set("Authorization", "Bearer " + session.accessToken);`,
      `}`,
      `headers.set("Accept", "application/json");`,
      `if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");`,
      `const body = typeof options.requestBody === "string" ? options.requestBody : JSON.stringify(options.requestBody ?? {});`,
      `const response = await fetch("/backend-api" + path, {`,
      `method: "POST", credentials: "include", headers, body, signal: options.signal`,
      `});`,
      `if (options.skipJsonTransform) return response;`,
      `if (!response.ok) throw new Error("ChatGPT request failed with status " + response.status);`,
      `return response.json();`,
      `}`,
      `};`,
      `window[${keyLiteral}] = { requestClient, resolveIntegrity };`,
    ].join("");
  }
  return [
    `import * as upstream from ${urlLiteral};`,
    `const names = ${contractLiteral};`,
    `window[${keyLiteral}] = {`,
    `finalizeRequirements: upstream[names.finalizeRequirements],`,
    `proofManager: upstream[names.proofManager],`,
    `turnstileManager: upstream[names.turnstileManager],`,
    `requestClient: upstream[names.requestClient],`,
    `buildSentinelHeaders: upstream[names.buildSentinelHeaders],`,
    `resolveIntegrity: names.resolveIntegrity ? upstream[names.resolveIntegrity] : undefined`,
    `};`,
  ].join("");
}

/**
 * Collector for the reasons a bridge load can fail. `script.onerror` receives
 * a bare Event with no reason attached, so without these listeners the only
 * thing reaching the operator is "failed to load".
 */
export function collectBridgeFailureSignals(page, assetUrl) {
  const signals = [];

  const onRequestFailed = (request) => {
    const url = request.url();
    // Only the module asset and the blob wrapper matter here. The page keeps
    // making its own requests while we wait, and an unrelated failure would be
    // a misleading explanation rather than no explanation.
    if (url !== assetUrl && !url.startsWith("blob:")) return;
    signals.push({
      kind: "requestfailed",
      detail: `${url} failed: ${request.failure()?.errorText ?? "unknown error"}`,
    });
  };
  const onPageError = (error) => {
    signals.push({
      kind: "pageerror",
      detail: error instanceof Error ? error.message : String(error),
    });
  };

  page.on("requestfailed", onRequestFailed);
  page.on("pageerror", onPageError);

  return {
    signals,
    dispose: () => {
      page.off("requestfailed", onRequestFailed);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * Compose the operator-facing reason from whatever was captured. A CSP
 * violation wins when present: it is the one cause that is a property of
 * chatgpt.com rather than of this install.
 */
export function describeBridgeLoadFailure(signals) {
  const base = "ChatGPT Web first-party bridge module failed to load";
  if (signals.length === 0) {
    return `${base} (no CSP violation, failed request or page error was captured)`;
  }
  const ranked =
    signals.find((signal) => signal.kind === "csp") ??
    signals.find((signal) => signal.kind === "requestfailed") ??
    signals[0];
  return `${base}: ${ranked.kind}: ${ranked.detail}`;
}

export async function ensureFirstPartyBridge(page) {
  const ready = await page.evaluate((key) => {
    const root = globalThis;
    return typeof root[key] === "object" && root[key] !== null;
  }, FIRST_PARTY_BRIDGE_KEY);
  if (ready) return;

  const { assetUrl, contract } = await discoverFirstPartyModule(page);
  const moduleSource = buildBridgeModuleSource(assetUrl, contract);
  const collected = collectBridgeFailureSignals(page, assetUrl);
  try {
    await page.evaluate(
      ({ bridgeKey, moduleSource: source }) =>
        new Promise((resolve, reject) => {
          const root = globalThis;
          if (typeof root[bridgeKey] === "object" && root[bridgeKey] !== null) {
            resolve();
            return;
          }
          // A CSP `script-src` refusal is only observable inside the page: it
          // does not surface as a failed request, and `script.onerror` carries
          // no reason. Captured here and folded into the rejection so it
          // survives back across the evaluate boundary.
          let cspDetail = "";
          const violationListener = new AbortController();
          document.addEventListener(
            "securitypolicyviolation",
            (event) => {
              if (!cspDetail) {
                cspDetail = `${event.violatedDirective} blocked ${event.blockedURI}`;
              }
            },
            { signal: violationListener.signal }
          );
          const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
          const script = document.createElement("script");
          script.type = "module";
          script.src = blobUrl;
          script.onload = () => {
            URL.revokeObjectURL(blobUrl);
            violationListener.abort();
            if (typeof root[bridgeKey] === "object" && root[bridgeKey] !== null) resolve();
            else reject(new Error("ChatGPT Web first-party bridge did not initialize"));
          };
          script.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            violationListener.abort();
            reject(new Error(cspDetail ? `csp: ${cspDetail}` : "no in-page reason"));
          };
          document.head.appendChild(script);
        }),
      { bridgeKey: FIRST_PARTY_BRIDGE_KEY, moduleSource }
    );
  } catch (error) {
    const inPage = error instanceof Error ? error.message : String(error);
    const signals = [...collected.signals];
    if (inPage.startsWith("csp: ")) {
      signals.unshift({ kind: "csp", detail: inPage.slice("csp: ".length) });
    } else if (inPage && inPage !== "no in-page reason") {
      signals.push({ kind: "pageerror", detail: inPage });
    }
    throw new Error(describeBridgeLoadFailure(signals));
  } finally {
    collected.dispose();
  }
}

export function directModel(selection) {
  if (selection.kind === "free") return { model: "auto", reason: selection.thinkEnabled };
  const base = selection.modelLabel === "GPT-5.6 Sol" ? "gpt-5-6" : "gpt-5-5";
  if (selection.effortIndex === 4) return { model: `${base}-pro`, reason: false };
  return { model: base, reason: selection.effortIndex > 0 };
}

async function registerAttachments(page, requestId, attachments) {
  return page.evaluate(
    async ({ abortKey, attachments: metadata, bridgeKey, requestId }) => {
      const root = globalThis;
      const bridge = root[bridgeKey];
      if (typeof bridge?.requestClient?.safePost !== "function") {
        throw new Error("ChatGPT Web first-party request client is unavailable");
      }
      const abortStore = (root[abortKey] ??= {});
      const controller = new AbortController();
      abortStore[requestId] = controller;
      const registered = [];
      for (const attachment of metadata) {
        const useCase = attachment.kind === "image" ? "multimodal" : "my_files";
        const response = await bridge.requestClient.safePost("/files", {
          requestBody: {
            file_name: attachment.name,
            file_size: attachment.size,
            use_case: useCase,
            timezone_offset_min: new Date().getTimezoneOffset(),
            reset_rate_limits: false,
            supports_direct_azure_multipart: true,
            mime_type: attachment.mimeType,
            entry_surface: "chat_composer",
            selection_method: "file_picker",
            client_resolved_mime_type: attachment.mimeType,
            mime_resolution_source: "filename_extension",
            store_in_library: false,
          },
          signal: controller.signal,
        });
        let payload = response;
        if (response instanceof Response) {
          if (!response.ok) {
            const status = response.status;
            await response.body?.cancel().catch(() => {});
            throw new Error(`ChatGPT Web file registration failed with status ${status}`);
          }
          payload = await response.json();
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          typeof payload.file_id !== "string" ||
          typeof payload.upload_url !== "string"
        ) {
          throw new Error("ChatGPT Web file registration returned an invalid response");
        }
        registered.push({
          fileId: payload.file_id,
          uploadUrl: payload.upload_url,
        });
      }
      return registered;
    },
    {
      abortKey: FIRST_PARTY_ABORT_KEY,
      attachments: attachments.map(({ kind, mimeType, name, size }) => ({
        kind,
        mimeType,
        name,
        size,
      })),
      bridgeKey: FIRST_PARTY_BRIDGE_KEY,
      requestId,
    }
  );
}

function requireUploadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !OAI_UPLOAD_HOST_RE.test(url.hostname)) {
    throw new Error("ChatGPT Web returned an invalid upload destination");
  }
  return url.toString();
}

async function uploadRegisteredAttachments(registered, signal) {
  for (const item of registered) {
    const response = await fetch(requireUploadUrl(item.uploadUrl), {
      method: "PUT",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": item.attachment.mimeType,
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": "2020-04-08",
      },
      body: new Uint8Array(item.attachment.data),
      signal: signal ?? undefined,
    });
    if (!response.ok) {
      throw new Error(`ChatGPT Web attachment upload failed with status ${response.status}`);
    }
  }
}

function browserConversationAttachments(registered) {
  return registered.map(({ attachment, fileId }) => ({
    fileId,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.size,
    width: attachment.width,
    height: attachment.height,
  }));
}

async function processRegisteredAttachments(page, requestId, registered) {
  await page.evaluate(
    async ({ abortKey, bridgeKey, registered, requestId }) => {
      const root = globalThis;
      const bridge = root[bridgeKey];
      if (typeof bridge?.requestClient?.safePost !== "function") {
        throw new Error("ChatGPT Web first-party request client is unavailable");
      }
      const abortStore = root[abortKey];
      const controller = abortStore?.[requestId];
      if (!controller) throw new Error("ChatGPT Web request cancellation scope is unavailable");

      for (const item of registered) {
        const useCase = item.kind === "image" ? "multimodal" : "my_files";
        const processResponse = await bridge.requestClient.safePost(
          "/files/process_upload_stream",
          {
            requestBody: {
              file_id: item.fileId,
              use_case: useCase,
              index_for_retrieval: item.kind !== "image",
              file_name: item.name,
              entry_surface: "chat_composer",
              metadata: {
                store_in_library: false,
                is_temporary_chat: true,
                library_eligibility_reason: "eligible",
                is_project_thread: false,
              },
            },
            signal: controller.signal,
            skipJsonTransform: true,
          }
        );
        if (processResponse instanceof Response) {
          const status = processResponse.status;
          const ok = processResponse.ok;
          await processResponse.text();
          if (!ok) {
            throw new Error(`ChatGPT Web file processing failed with status ${status}`);
          }
        }
      }
    },
    { abortKey: FIRST_PARTY_ABORT_KEY, bridgeKey: FIRST_PARTY_BRIDGE_KEY, registered, requestId }
  );
}

async function storeConversationDraft(page, input, requestId, registered) {
  const mode = directModel(input.selection);
  await page.evaluate(
    ({ mode, prompt, registered, requestId, requestKey, pluginHints }) => {
      const root = globalThis;
      const images = registered.filter((item) => item.kind === "image");
      const attachments = registered.map((item) => ({
        id: item.fileId,
        size: item.size,
        name: item.name,
        mime_type: item.mimeType,
        ...(item.kind === "image"
          ? { width: item.width, height: item.height }
          : { non_library_my_files_injest_upload: true }),
        source: "local",
        is_big_paste: false,
      }));
      // Account-level MCP connectors join the turn via "plugin:<app_id>" hints
      // (the same field the web composer sets when a plugin chip is toggled).
      const systemHints = [
        ...(mode.reason ? ["reason"] : []),
        ...(Array.isArray(pluginHints) ? pluginHints : []),
      ];
      const metadata = {
        ...(systemHints.length ? { system_hints: systemHints } : {}),
        ...(attachments.length ? { attachments } : {}),
        serialization_metadata: { custom_symbol_offsets: [] },
      };
      const content = images.length
        ? {
            content_type: "multimodal_text",
            parts: [
              ...images.map((item) => ({
                content_type: "image_asset_pointer",
                asset_pointer: `sediment://${item.fileId}`,
                size_bytes: item.size,
                width: item.width,
                height: item.height,
              })),
              prompt,
            ],
          }
        : { content_type: "text", parts: [prompt] };
      const requestStore = (root[requestKey] ??= {});
      requestStore[requestId] = {
        body: {
          action: "next",
          messages: [
            {
              id: crypto.randomUUID(),
              author: { role: "user" },
              create_time: Date.now() / 1000,
              content,
              metadata,
            },
          ],
          parent_message_id: "client-created-root",
          model: mode.model,
          timezone_offset_min: new Date().getTimezoneOffset(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          history_and_training_disabled: true,
          conversation_mode: { kind: "primary_assistant" },
          system_hints: systemHints,
          supports_buffering: true,
          supported_encodings: ["v1"],
        },
      };
    },
    {
      mode,
      prompt: input.prompt,
      registered,
      requestId,
      requestKey: FIRST_PARTY_REQUEST_KEY,
      pluginHints: Array.isArray(input.pluginHints) ? input.pluginHints : [],
    }
  );
}

async function storeConversationHeaders(page, requestId) {
  await page.evaluate(
    async ({ abortKey, bridgeKey, requestId, requestKey }) => {
      const root = globalThis;
      const bridge = root[bridgeKey];
      const legacyBridgeReady = [
        bridge?.finalizeRequirements,
        bridge?.proofManager?.getEnforcementToken,
        bridge?.turnstileManager?.getEnforcementToken,
        bridge?.buildSentinelHeaders,
      ].every((member) => typeof member === "function");
      const resolverReady =
        typeof bridge?.resolveIntegrity === "function" &&
        typeof bridge?.requestClient?.safePost === "function";
      if (!legacyBridgeReady && !resolverReady) {
        throw new Error("ChatGPT Web first-party challenge bridge is incomplete");
      }
      const controller = (root[abortKey])?.[requestId];
      const draft = (root[requestKey])?.[requestId];
      if (!controller || !draft) throw new Error("ChatGPT Web request scope is unavailable");

      if (resolverReady) {
        const integrity = await bridge.resolveIntegrity(async (proof) =>
          bridge.requestClient.safePost("/sentinel/chat-requirements/prepare", {
            requestBody: { p: proof },
            signal: controller.signal,
          })
        );
        draft.additionalHeaders = integrity?.headers ?? {};
      } else {
        const requirements = await bridge.finalizeRequirements(false, "none");
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const [proof, turnstile] = await Promise.all([
          bridge.proofManager.getEnforcementToken(requirements, { forceSync: true }),
          bridge.turnstileManager.getEnforcementToken(requirements),
        ]);
        const additionalHeaders = bridge.buildSentinelHeaders(
          requirements,
          turnstile,
          proof,
          null,
          null,
          null
        );
        draft.additionalHeaders = additionalHeaders;
      }
    },
    {
      abortKey: FIRST_PARTY_ABORT_KEY,
      bridgeKey: FIRST_PARTY_BRIDGE_KEY,
      requestId,
      requestKey: FIRST_PARTY_REQUEST_KEY,
    }
  );
}

async function submitConversationRequest(page, requestId) {
  await page.evaluate(
    async ({ abortKey, bridgeKey, requestId, requestKey }) => {
      const root = globalThis;
      const requestClient = (root[bridgeKey])?.requestClient;
      const controller = (root[abortKey])?.[requestId];
      const draft = (root[requestKey])?.[requestId];
      if (typeof requestClient?.safePost !== "function" || !controller || !draft) {
        throw new Error("ChatGPT Web conversation request scope is unavailable");
      }
      const response = await requestClient.safePost("/f/conversation", {
        requestBody: draft.body,
        additionalHeaders: draft.additionalHeaders,
        signal: controller.signal,
        skipJsonTransform: true,
      });
      if (!(response instanceof Response)) {
        throw new Error("ChatGPT Web conversation returned an invalid response");
      }
      if (!response.ok) {
        const status = response.status;
        let detail = "";
        try {
          const payload = await response.json();
          const nested =
            payload.detail && typeof payload.detail === "object"
              ? payload.detail
              : payload.error && typeof payload.error === "object"
                ? payload.error
                : payload;
          const candidate = nested.code ?? nested.message ?? nested.type;
          if (typeof candidate === "string") detail = candidate.slice(0, 160);
        } catch {
          await response.body?.cancel().catch(() => {});
        }
        throw new Error(
          `ChatGPT Web conversation failed with status ${status}${detail ? ` (${detail})` : ""}`
        );
      }
      draft.response = response;
    },
    {
      abortKey: FIRST_PARTY_ABORT_KEY,
      bridgeKey: FIRST_PARTY_BRIDGE_KEY,
      requestId,
      requestKey: FIRST_PARTY_REQUEST_KEY,
    }
  );
}

async function readConversationResponse(page, requestId) {
  return page.evaluate(
    async ({ requestId, requestKey, responseLimit }) => {
      const root = globalThis;
      const draft = (root[requestKey])?.[requestId];
      const response = draft?.response;
      if (!(response instanceof Response)) {
        throw new Error("ChatGPT Web conversation response is unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("ChatGPT Web conversation returned an empty stream");
      const decoder = new TextDecoder();
      const chunks = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > responseLimit) {
            await reader.cancel().catch(() => {});
            throw new Error("ChatGPT Web conversation response exceeded the size limit");
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // The stream can already be released after cancellation.
        }
      }
      return chunks.join("");
    },
    {
      requestId,
      requestKey: FIRST_PARTY_REQUEST_KEY,
      responseLimit: MAX_CONVERSATION_RESPONSE_BYTES,
    }
  );
}

async function processAndSubmit(page, input, requestId, registered) {
  const browserRegistered = browserConversationAttachments(registered);
  await processRegisteredAttachments(page, requestId, browserRegistered);
  await storeConversationDraft(page, input, requestId, browserRegistered);
  await storeConversationHeaders(page, requestId);
  await submitConversationRequest(page, requestId);
  return readConversationResponse(page, requestId);
}

async function cleanupRequest(page, requestId) {
  await page
    .evaluate(
      ({ abortKey, requestId, requestKey }) => {
        const root = globalThis;
        const abortStore = root[abortKey];
        const requestStore = root[requestKey];
        delete abortStore?.[requestId];
        delete requestStore?.[requestId];
      },
      { abortKey: FIRST_PARTY_ABORT_KEY, requestId, requestKey: FIRST_PARTY_REQUEST_KEY }
    )
    .catch(() => {});
}

export async function abortChatGptWebFirstPartyTurn(page, requestId) {
  await page
    .evaluate(
      ({ abortKey, requestId }) => {
        const root = globalThis;
        const store = root[abortKey];
        store?.[requestId]?.abort();
      },
      { abortKey: FIRST_PARTY_ABORT_KEY, requestId }
    )
    .catch(() => {});
}

async function runSerialized(page, task) {
  const previous = pageRequestTails.get(page) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  pageRequestTails.set(page, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (pageRequestTails.get(page) === tail) pageRequestTails.delete(page);
  }
}

export async function executeChatGptWebFirstPartyTurn(page, input, options = {}) {
  const requestId = options.requestId ?? crypto.randomUUID();
  return runSerialized(page, async () => {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const abort = () => {
      void abortChatGptWebFirstPartyTurn(page, requestId);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await ensureFirstPartyBridge(page);
      const registrations = await registerAttachments(page, requestId, input.attachments);
      const registered = registrations.map((registration, index) => ({
        ...registration,
        attachment: input.attachments[index],
      }));
      await uploadRegisteredAttachments(registered, options.signal);
      return await processAndSubmit(page, input, requestId, registered);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      await cleanupRequest(page, requestId);
    }
  });
}

// open-sse/handlers/chatCore.ts
// Phase 5 Wave 4 — Surface C structural conversion.
// Central chat handler shared between SSE and Worker.
// Runtime behaviour is UNCHANGED; only types added.

import { detectFormat, getTargetFormat } from "../services/provider.js";
import {
	translateRequest,
	translateResponse,
	initState,
	initTranslators,
} from "../translator/index.js";
import type { TranslatorState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import {
	validateOutboundPayload,
	stripInternalKeys,
} from "../translator/validate.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import {
	getModelTargetFormat,
	getModelStrip,
	getModelUpstreamId,
	getModelType,
	PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import {
	createErrorResult,
	parseUpstreamError,
	formatProviderError,
} from "../utils/error.js";
import { HTTP_STATUS, VALIDATE_OUTBOUND } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import {
	trackPendingRequest,
	appendRequestLog,
	saveRequestDetail,
} from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import {
	buildRequestDetail,
	extractRequestConfig,
} from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import {
	handleStreamingResponse,
	buildOnStreamComplete,
} from "./chatCore/streamingHandler.js";
import {
	detectClientTool,
	isNativePassthrough,
} from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog } from "../rtk/headroom.js";
import { recordHeadroomStats } from "../rtk/headroomStats.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
// Step-2/3 schema + concerns imports
import {
	OPENAI_BLOCK,
	CLAUDE_BLOCK,
	RESPONSES_ITEM,
} from "../translator/schema/blocks.js";
import {
	OPENAI_FINISH,
	CLAUDE_STOP,
	GEMINI_FINISH,
} from "../translator/schema/finishReasons.js";
import { buildChunk } from "../translator/concerns/chunk.js";
import type { ChunkMeta, OpenAIChunkResult } from "../translator/concerns/chunk.js";
import { toOpenAIFinish, fromOpenAIFinish } from "../translator/concerns/finishReason.js";

// Wave-1 type imports (executor / error / stream / blocks / finishReason / formats / ids / guards)
import type {
	ExecutorResult,
	ExecutorLog,
	ExecutorCredentials,
	ProxyOptions,
	JsonValue,
	ExecutorFetchResult,
	Executor,
} from "../types/executor.js";
import type { OpenAIErrorBody, ErrorEnvelope, ErrorType, ErrorCode } from "../types/error.js";
import type { SSEEvent, OpenAIChunk, ClaudeChunk, GeminiChunk, StreamWriter } from "../types/stream.js";
import type {
	OpenAIContentBlock,
	ClaudeContentBlock,
	ResponsesItem,
} from "../types/blocks.js";
import type {
	OpenAIFinishReason,
	ClaudeStopReason,
	GeminiFinishReason,
} from "../types/finishReason.js";
import type { Format, Role } from "../types/formats.js";
import type { ProviderId, ModelId, InstanceId } from "../types/ids.js";
import { asProviderId, asModelId, asInstanceId } from "../types/ids.js";
import { isOpenAIErrorBody, parseProviderError, isJsonRpcResponse } from "../types/guards.js";

// ---------------------------------------------------------------------------
// Local type aliases — narrow shapes used only within this file
// ---------------------------------------------------------------------------

/** Mutable request body; typed as a plain JSON-serialisable object. */
type RequestBody = Record<string, JsonValue>;

/** Concrete shape of headroom stats returned by compressWithHeadroom. */
interface HeadroomStats {
	tokens_before?: number;
	tokens_after?: number;
	tokens_saved?: number;
	model?: string;
	source?: string;
	[key: string]: JsonValue | undefined;
}

/** Entry shape preserved at appendRequestLog call sites (runtime no-op; TS boundary only). */
interface RequestLogEntry {
	model: string;
	provider: string;
	connectionId: string;
	status: string;
}

/**
* Typed cast of appendRequestLog so call sites can keep their payload without TS errors.
* appendRequestLog() is a runtime no-op (zero-arg); the cast preserves observable behavior.
*/
const appendRequestLogWithPayload = appendRequestLog as (entry: RequestLogEntry) => Promise<void>;

/** Typed cast for executor.execute — avoids exactOptionalPropertyTypes friction at call sites. */
type ExecuteParams = {
	model: string;
	body: Record<string, JsonValue>;
	stream: boolean;
	credentials: ExecutorCredentials;
	signal?: AbortSignal;
	/** JS-boundary: undefined accepted (exactOptionalPropertyTypes does not apply here). */
	log: ExecutorLog | undefined;
	proxyOptions?: ProxyOptions | null;
};
type ExecutorWithExecute = { execute(p: ExecuteParams): Promise<ExecutorFetchResult> } & Omit<Executor, "execute">;

/**
* Typed wrapper for compressWithHeadroom (JS boundary).
* compressWithHeadroom accepts {enabled,url,model,source,timeoutMs} options.
*/
type CompressWithHeadroomFn = (
	body: RequestBody,
	opts: { enabled: boolean | undefined; url: string | undefined; model: string; source: string; timeoutMs?: number },
) => Promise<HeadroomStats | null>;
const compressWithHeadroomTyped = compressWithHeadroom as CompressWithHeadroomFn;

/**
* Typed wrapper for recordHeadroomStats (JS boundary).
*/
type RecordHeadroomStatsFn = (stats: HeadroomStats, opts: { connectionId?: string }) => void;
const recordHeadroomStatsTyped = recordHeadroomStats as RecordHeadroomStatsFn;

/**
 * Parameters accepted by handleChatCore.
 * All optional fields are truly optional — exactOptionalPropertyTypes applies.
 */
export interface HandleChatCoreParams {
	body: RequestBody;
	modelInfo: { provider: string; model: string };
	credentials: ExecutorCredentials;
	log?: ExecutorLog;
	onCredentialsRefreshed?: (creds: Partial<ExecutorCredentials>) => Promise<void> | void;
	onRequestSuccess?: () => void;
	onDisconnect?: (reason?: string) => void;
	clientRawRequest?: {
		headers: Record<string, string>;
		body?: JsonValue;
		endpoint?: string;
	};
	connectionId: string;
	userAgent?: string;
	apiKey?: string;
	ccFilterNaming?: boolean;
	rtkEnabled?: boolean;
	headroomEnabled?: boolean;
	headroomUrl?: string;
	headroomSource?: string;
	cavemanEnabled?: boolean;
	cavemanLevel?: string;
	ponytailEnabled?: boolean;
	ponytailLevel?: string;
	sourceFormatOverride?: string;
	providerThinking?: { mode?: string };
}

/**
 * Core chat handler — shared between SSE and Worker.
 */
export async function handleChatCore({
	body: rawBody,
	modelInfo,
	credentials,
	log,
	onCredentialsRefreshed,
	onRequestSuccess,
	onDisconnect,
	clientRawRequest,
	connectionId,
	userAgent,
	apiKey,
	ccFilterNaming,
	rtkEnabled,
	headroomEnabled,
	headroomUrl,
	headroomSource = "custom",
	cavemanEnabled,
	cavemanLevel,
	ponytailEnabled,
	ponytailLevel,
	sourceFormatOverride,
	providerThinking,
}: HandleChatCoreParams): Promise<ExecutorResult> {
	const { provider, model } = modelInfo;
	const requestStartTime = Date.now();

	// body is mutated at several points; keep as a mutable local copy.
	let body: RequestBody = rawBody;

	const sourceFormat: string = sourceFormatOverride ?? detectFormat(body) as string;

	// Check for bypass patterns (warmup, skip, cc naming)
	// handleBypassRequest returns Response | null (JS); treat as unknown boundary.
	const bypassResponse = handleBypassRequest(
		body,
		model,
		userAgent ?? "",
		ccFilterNaming,
	) as ExecutorResult | null;
	if (bypassResponse) return bypassResponse;

	const alias: string =
		(PROVIDER_ID_TO_ALIAS as Record<string, string>)[provider] ?? provider;
	const modelTargetFormat: string | null = getModelTargetFormat(alias, model) as string | null;
	const targetFormat: string = modelTargetFormat ?? (getTargetFormat(provider) as string);
	const stripList: string[] = (getModelStrip(alias, model) as string[] | null) ?? [];
	const upstreamModel: string = (getModelUpstreamId(alias, model) as string | null) ?? model;

	// Inject provider-level thinking config override (only if client hasn't set)
	// on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
	if (providerThinking?.mode && providerThinking.mode !== "auto") {
		const mode = providerThinking.mode;
		if (mode === "on" && !body["thinking"]) {
			console.log("Injecting provider-level thinking config override: on");
			body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
		} else if (mode === "off" && !body["thinking"]) {
			body = { ...body, thinking: { type: "disabled" } };
		} else if (!body["reasoning_effort"]) {
			body = { ...body, reasoning_effort: mode };
		}
	}

	// FORMATS values are plain strings; cast to string for comparison.
	const antigravityFmt: string = FORMATS.ANTIGRAVITY as string;
	const geminiCliFmt: string = FORMATS.GEMINI_CLI as string;
	const geminiFmt: string = FORMATS.GEMINI as string;

	const clientRequestedStreaming: boolean =
		body["stream"] === true ||
		sourceFormat === antigravityFmt ||
		sourceFormat === geminiFmt ||
		sourceFormat === geminiCliFmt;

	// PROVIDERS is a Record<string, { forceStream?: boolean }> in JS; narrow at boundary.
	const providerConfig = (PROVIDERS as Record<string, { forceStream?: boolean } | undefined>)[provider];
	const providerRequiresStreaming: boolean = providerConfig?.forceStream === true;
	let stream: boolean = providerRequiresStreaming ? true : body["stream"] !== false;

	// CodeWhale (formerly DeepSeek TUI): interactive TUI panel sends stream:true
	// and needs SSE. Non-interactive mode (-p flag) sends without stream and
	// can't parse SSE. Only force non-streaming when client didn't explicitly request it.
	const rawHeaders: Record<string, string> = clientRawRequest?.headers ?? {};
	const detectedTool: string | null = detectClientTool(rawHeaders, body) as string | null;
	if (detectedTool === "codewhale" && body["stream"] !== true) stream = false;

	// Check client Accept header preference for non-streaming requests
	// This fixes AI SDK compatibility where clients send Accept: application/json
	const acceptHeader: string = rawHeaders["accept"] ?? "";
	const clientPrefersJson: boolean = acceptHeader.includes("application/json");
	const clientPrefersSSE: boolean = acceptHeader.includes("text/event-stream");
	if (clientPrefersJson && !clientPrefersSSE && body["stream"] !== true) {
		stream = false;
	}

	const reqLogger = await createRequestLogger(
		sourceFormat,
		targetFormat,
		model,
	) as {
		logClientRawRequest(endpoint: string | undefined, body: JsonValue | undefined, headers: Record<string, string>): void;
		logRawRequest(b: RequestBody): void;
		logTargetRequest(url: string, headers: Record<string, string>, body: RequestBody): void;
		logOpenAIRequest?(r: RequestBody): void;
		logError(err: Error, body: RequestBody | null): void;
	};

	if (clientRawRequest) {
		reqLogger.logClientRawRequest(
			clientRawRequest.endpoint,
			clientRawRequest.body,
			clientRawRequest.headers,
		);
	}
	reqLogger.logRawRequest(body);
	log?.debug?.(
		"FORMAT",
		`${sourceFormat} → ${targetFormat} | stream=${String(stream)}`,
	);

	// Native passthrough: CLI tool and provider are the same ecosystem
	// Skip all translation/normalization — only model and Bearer are swapped
	const clientTool: string | null = detectClientTool(rawHeaders, body) as string | null;
	const passthrough: boolean = isNativePassthrough(clientTool, provider) as boolean;

	// Expose raw client headers to translators/executors for session-id resolution
	// credentials.rawHeaders is defined as Record<string,string> | undefined — safe write.
	credentials.rawHeaders = rawHeaders;

	// Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
	if (!passthrough) {
		const caps = getCapabilitiesForModel(provider, model) as Record<string, boolean>;
		if (stripUnsupportedModalities(body, sourceFormat, caps) as boolean) {
			log?.debug?.(
				"MODALITY",
				`stripped unsupported media for ${provider}/${model}`,
			);
		}
		// Convert remote image URLs to base64 for targets that can't fetch URLs.
		try {
			const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, {
				signal: undefined,
			}) as number;
			if (n > 0)
				log?.debug?.(
					"MODALITY",
					`prefetched ${n} remote image(s) for ${targetFormat}`,
				);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log?.warn?.("MODALITY", `image prefetch failed: ${msg}`);
		}
	}

	// translatedBody may carry a non-JsonValue side-channel _toolNameMap (Map).
	// We delete it immediately after extraction; typed as broad to allow that.
	let translatedBody: RequestBody & { _toolNameMap?: Map<string, string> | JsonValue };
	let toolNameMap: Map<string, string> | undefined;

	if (passthrough) {
		log?.debug?.(
			"PASSTHROUGH",
			`${clientTool ?? "unknown"} → ${provider} | native lossless`,
		);
		translatedBody = { ...body, model: upstreamModel };
		// Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
		if (clientTool === "claude")
			normalizeClaudePassthrough(translatedBody, upstreamModel);
	} else {
		const translated = translateRequest(
			sourceFormat,
			targetFormat,
			upstreamModel,
			body,
			stream,
			credentials as Parameters<typeof translateRequest>[5],
			provider,
			reqLogger,
			stripList,
			connectionId,
			clientTool,
		);
		if (!translated) {
			trackPendingRequest(model, provider, connectionId, false, true);
			return createErrorResult(
				HTTP_STATUS.BAD_REQUEST as number,
				`Failed to translate request for ${sourceFormat} → ${targetFormat}`,
			) as ExecutorResult;
		}
		translatedBody = translated as RequestBody & { _toolNameMap?: Map<string, string> };
		// _toolNameMap is a side-channel Map (not JsonValue); extract + delete before dispatch.
		const rawMap = translatedBody["_toolNameMap"];
		if (rawMap instanceof Map) {
			toolNameMap = rawMap;
		}
		delete translatedBody["_toolNameMap"];
		translatedBody["model"] = upstreamModel;
	}

	// Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
	if (clientTool === "claude" && Array.isArray(translatedBody["tools"])) {
		const dedupeResult = dedupeTools(translatedBody["tools"]) as { tools: JsonValue[]; stripped: string[] };
		const { tools: deduped, stripped } = dedupeResult;
		if (stripped.length > 0) {
			translatedBody["tools"] = deduped;
			log?.debug?.(
				"TOOLDEDUP",
				`stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`,
			);
		}
	}

	// Token savers: applied at the final body just before dispatch
	// Covers both passthrough (source shape) and translated (target shape) flows
	const finalFormat: string = passthrough ? sourceFormat : targetFormat;

	// TTS models don't support tool messages/function calling
	const modelType = getModelType(alias, model) as string | null;
	if (modelType === "tts" && Array.isArray(translatedBody["messages"])) {
		translatedBody["messages"] = (translatedBody["messages"] as JsonValue[]).filter(
			(msg) => {
				const m = msg as Record<string, JsonValue>;
				return m["role"] !== "tool";
			},
		);
		delete translatedBody["tools"];
	}

	// RTK: compress tool_result content
	const rtkStats: JsonValue = compressMessages(translatedBody, rtkEnabled) as JsonValue;
	const rtkLine: string | null = formatRtkLog(rtkStats) as string | null;
	if (rtkLine) console.log(rtkLine);

	// Headroom: optional external proxy compression; fail open if proxy is absent.
	const headroomStats: HeadroomStats | null = await compressWithHeadroomTyped(translatedBody, {
		enabled: headroomEnabled,
		url: headroomUrl,
		model: upstreamModel,
		source: headroomSource,
	});
	const headroomLine: string | null = formatHeadroomLog(headroomStats) as string | null;
	if (headroomLine) console.log(headroomLine);
	if (headroomStats) recordHeadroomStatsTyped(headroomStats, { connectionId });

	// Caveman: inject terse-style system prompt
	if (cavemanEnabled && cavemanLevel) {
		injectCaveman(translatedBody, finalFormat, cavemanLevel);
		log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
	}

	// Ponytail: tail-focus ruleset (composes after caveman)
	if (ponytailEnabled && ponytailLevel) {
		injectPonytail(translatedBody, finalFormat, ponytailLevel);
		log?.debug?.("PONYTAIL", `${ponytailLevel} | ${finalFormat}`);
	}

	const executor = getExecutor(provider) as ExecutorWithExecute & { noAuth?: boolean; refreshCredentials(c: ExecutorCredentials, l: ExecutorLog): Promise<Partial<ExecutorCredentials> | null>; parseError(r: Response, t: string): { status: number; message: string } };
	trackPendingRequest(model, provider, connectionId, true);
	appendRequestLogWithPayload({ model, provider, connectionId, status: "PENDING" }).catch(
		() => {},
	);

	// noUncheckedIndexedAccess: array accesses are potentially undefined; count safely.
	const messagesArr = translatedBody["messages"];
	const inputArr = translatedBody["input"];
	const contentsArr = translatedBody["contents"];
	const requestContentsArr =
		typeof translatedBody["request"] === "object" &&
		translatedBody["request"] !== null &&
		!Array.isArray(translatedBody["request"])
			? (translatedBody["request"] as Record<string, JsonValue>)["contents"]
			: undefined;
	const msgCount: number =
		(Array.isArray(messagesArr) ? messagesArr.length : 0) ||
		(Array.isArray(inputArr) ? inputArr.length : 0) ||
		(Array.isArray(contentsArr) ? contentsArr.length : 0) ||
		(Array.isArray(requestContentsArr) ? requestContentsArr.length : 0) ||
		0;
	log?.debug?.(
		"REQUEST",
		`${provider.toUpperCase()} | ${model} | ${msgCount} msgs`,
	);

	const streamController = (createStreamController as (opts: {
		onDisconnect?: (reason: string) => void;
		onError?: () => void;
		log: ExecutorLog | undefined;
		provider?: string;
		model?: string;
	}) => { signal: AbortSignal; handleError(e: Error): void; handleComplete(): void })({
		onDisconnect: (reason: string) => {
			trackPendingRequest(model, provider, connectionId, false);
			if (onDisconnect) onDisconnect(reason);
		},
		onError: () => trackPendingRequest(model, provider, connectionId, false),
		log,
		provider,
		model,
	});

	const proxyOptions: ProxyOptions = {
		connectionProxyEnabled:
			credentials.providerSpecificData?.connectionProxyEnabled === true,
		connectionProxyUrl:
			credentials.providerSpecificData?.connectionProxyUrl ?? "",
		connectionNoProxy:
			credentials.providerSpecificData?.connectionNoProxy ?? "",
		vercelRelayUrl: credentials.providerSpecificData?.vercelRelayUrl ?? "",
	};

	if (proxyOptions.vercelRelayUrl) {
		const connectionName: string =
			credentials.connectionName ?? credentials.connectionId ?? "unknown";
		const poolId: string =
			credentials.providerSpecificData?.connectionProxyPoolId ?? "none";
		log?.info?.(
			"PROXY",
			`${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`,
		);
	} else if (
		proxyOptions.connectionProxyEnabled &&
		proxyOptions.connectionProxyUrl
	) {
		let maskedProxyUrl: string = proxyOptions.connectionProxyUrl;
		try {
			const parsed = new URL(proxyOptions.connectionProxyUrl);
			const host: string = parsed.hostname;
			const port: string = parsed.port ? `:${parsed.port}` : "";
			const protocol: string = parsed.protocol;
			maskedProxyUrl = `${protocol}//${host}${port}`;
		} catch {
			// Keep raw if URL parsing fails
		}

		const poolId: string =
			credentials.providerSpecificData?.connectionProxyPoolId ?? "none";
		const connectionName: string =
			credentials.connectionName ?? credentials.connectionId ?? "unknown";
		log?.info?.(
			"PROXY",
			`${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`,
		);
	}

	if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
		const connectionName: string =
			credentials.connectionName ?? credentials.connectionId ?? "unknown";
		log?.debug?.(
			"PROXY",
			`${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`,
		);
	}

	// Outbound validation gate. Run format-specific shape checks (which also
	// catch leftover internal keys) FIRST so the gate can return 400 with a
	// precise error. After the gate passes, strip any remaining underscore
	// keys defensively — this is the passthrough safety net.
	if (VALIDATE_OUTBOUND) {
		const validation = validateOutboundPayload(finalFormat, translatedBody) as {
			ok: boolean;
			errors: Array<{ path: string; message: string }>;
		};
		if (!validation.ok) {
			const summary: string = validation.errors
				.slice(0, 5)
				.map((e) => `${e.path}: ${e.message}`)
				.join("; ");
			const detail: string =
				validation.errors.length > 5
					? ` (showing 5 of ${validation.errors.length} errors)`
					: "";
			const errMsg = `Outbound payload validation failed for ${finalFormat}: ${summary}${detail}`;
			console.log(`${COLORS.red as string}[VALIDATE] ${errMsg}${COLORS.reset as string}`);
			log?.warn?.(
				"VALIDATE",
				`${provider.toUpperCase()} | ${model} | ${summary}`,
			);
			// Track failure with the same full-signature the executor-error path uses.
			trackPendingRequest(model, provider, connectionId, false, true);
			appendRequestLogWithPayload({
				model,
				provider,
				connectionId,
				status: `FAILED ${HTTP_STATUS.BAD_REQUEST as number}`,
			}).catch(() => {});
			saveRequestDetail(
				buildRequestDetail({
					provider,
					model,
					connectionId,
					latency: { ttft: 0, total: Date.now() - requestStartTime },
					tokens: { prompt_tokens: 0, completion_tokens: 0 },
					request: extractRequestConfig(body, stream),
					providerRequest: translatedBody ?? null,
					response: {
						error: errMsg,
						status: HTTP_STATUS.BAD_REQUEST as number,
						thinking: null,
					},
					status: "error",
				}),
			).catch(() => {});
			return createErrorResult(HTTP_STATUS.BAD_REQUEST as number, errMsg) as ExecutorResult;
		}
	}
	// Defensive strip AFTER the gate.
	stripInternalKeys(translatedBody);

	// Execute request
	let providerResponse: Response;
	let providerUrl: string;
	let providerHeaders: Record<string, string>;
	let finalBody: RequestBody;
	try {
		const result: ExecutorFetchResult = await executor.execute({
			model,
			body: translatedBody as Record<string, JsonValue>,
			stream,
			credentials,
			signal: streamController.signal,
			log,
			proxyOptions,
		});
		providerResponse = result.response;
		providerUrl = result.url;
		providerHeaders = result.headers;
		finalBody = result.transformedBody;
		reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		const isAbort: boolean = err.name === "AbortError";
		trackPendingRequest(model, provider, connectionId, false, true);
		appendRequestLogWithPayload({
			model,
			provider,
			connectionId,
			status: `FAILED ${isAbort ? 499 : HTTP_STATUS.BAD_GATEWAY as number}`,
		}).catch(() => {});
		saveRequestDetail(
			buildRequestDetail({
				provider,
				model,
				connectionId,
				latency: { ttft: 0, total: Date.now() - requestStartTime },
				tokens: { prompt_tokens: 0, completion_tokens: 0 },
				request: extractRequestConfig(body, stream),
				providerRequest: translatedBody ?? null,
				response: {
					error: err.message,
					status: isAbort ? 499 : 502,
					thinking: null,
				},
				status: "error",
			}),
		).catch(() => {});

		if (isAbort) {
			streamController.handleError(err);
			return createErrorResult(499, "Request aborted") as ExecutorResult;
		}
		const errMsg: string = formatProviderError(
			err as Error & { code?: string; cause?: { code?: string; message?: string } },
			provider,
			model,
			HTTP_STATUS.BAD_GATEWAY as number,
		) as string;
		console.log(`${COLORS.red as string}[ERROR] ${errMsg}${COLORS.reset as string}`);
		return createErrorResult(HTTP_STATUS.BAD_GATEWAY as number, errMsg) as ExecutorResult;
	}

	// Handle 401/403 - try token refresh (skip for noAuth providers)
	if (
		!executor.noAuth &&
		(providerResponse.status === (HTTP_STATUS.UNAUTHORIZED as number) ||
			providerResponse.status === (HTTP_STATUS.FORBIDDEN as number))
	) {
		try {
			const newCredentials = await (refreshWithRetry as (fn: () => Promise<Partial<ExecutorCredentials> | null>, retries: number, log: ExecutorLog | null | undefined) => Promise<Partial<ExecutorCredentials> | null>)(
				() => executor.refreshCredentials(credentials, log ?? {} as ExecutorLog),
				3,
				log ?? null,
			);
			if (newCredentials?.accessToken ?? newCredentials?.copilotToken) {
				log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
				Object.assign(credentials, newCredentials);
				if (onCredentialsRefreshed) {
					try {
						await onCredentialsRefreshed(newCredentials ?? {});
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${msg}`);
					}
				}
				try {
					const retryResult: ExecutorFetchResult = await executor.execute({
						model,
						body: translatedBody as Record<string, JsonValue>,
						stream,
						credentials,
						signal: streamController.signal,
						log,
						proxyOptions,
					});
					if (retryResult.response.ok) {
						providerResponse = retryResult.response;
						providerUrl = retryResult.url;
					}
				} catch {
					log?.warn?.(
						"TOKEN",
						`${provider.toUpperCase()} | retry after refresh failed`,
					);
				}
			} else {
				log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log?.warn?.(
				"TOKEN",
				`${provider.toUpperCase()} | refresh threw: ${msg}`,
			);
		}
	}

	// Provider returned error
	if (!providerResponse.ok) {
		trackPendingRequest(model, provider, connectionId, false, true);
		const { statusCode, message, resetsAtMs } = await parseUpstreamError(
			providerResponse,
			executor,
		) as { statusCode: number; message: string; resetsAtMs?: number };
		appendRequestLogWithPayload({
			model,
			provider,
			connectionId,
			status: `FAILED ${statusCode}`,
		}).catch(() => {});
		saveRequestDetail(
			buildRequestDetail({
				provider,
				model,
				connectionId,
				latency: { ttft: 0, total: Date.now() - requestStartTime },
				tokens: { prompt_tokens: 0, completion_tokens: 0 },
				request: extractRequestConfig(body, stream),
				providerRequest: finalBody ?? translatedBody ?? null,
				response: { error: message, status: statusCode, thinking: null },
				status: "error",
			}),
		).catch(() => {});

		const errMsg: string = formatProviderError(
			(new Error(message)) as Error & { code?: string; cause?: { code?: string; message?: string } },
			provider,
			model,
			statusCode,
		) as string;
		console.log(`${COLORS.red as string}[ERROR] ${errMsg}${COLORS.reset as string}`);
		reqLogger.logError(new Error(message), finalBody ?? translatedBody ?? null);
		return createErrorResult(statusCode, errMsg, resetsAtMs) as ExecutorResult;
	}

	const sharedCtx = {
		provider,
		model,
		body,
		stream,
		translatedBody,
		finalBody,
		requestStartTime,
		connectionId,
		apiKey,
		clientRawRequest,
		onRequestSuccess,
	};
	const appendLog = (extra: Record<string, JsonValue>) =>
		appendRequestLogWithPayload({ model, provider, connectionId, status: String(extra["status"] ?? "") }).catch(
			() => {},
		);
	const trackDone = () =>
		trackPendingRequest(model, provider, connectionId, false);

	// Provider forced streaming but client wants JSON
	if (!clientRequestedStreaming && providerRequiresStreaming) {
		const result = await handleForcedSSEToJson({
			...sharedCtx,
			providerResponse,
			sourceFormat,
			trackDone,
			appendLog,
		}) as ExecutorResult | null;
		if (result) {
			streamController.handleComplete();
			return result;
		}
	}

	// True non-streaming response
	if (!stream) {
		const result = await handleNonStreamingResponse({
			...sharedCtx,
			providerResponse,
			sourceFormat,
			targetFormat,
			reqLogger,
			toolNameMap,
			trackDone,
			appendLog,
		}) as ExecutorResult;
		streamController.handleComplete();
		return result;
	}

	// Streaming response
	const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
		...sharedCtx,
	}) as { onStreamComplete: (...args: JsonValue[]) => void; streamDetailId: string };
	return handleStreamingResponse({
		...sharedCtx,
		providerResponse,
		sourceFormat,
		targetFormat,
		userAgent,
		reqLogger,
		toolNameMap,
		streamController,
		onStreamComplete,
		streamDetailId,
	}) as ExecutorResult;
}

export function isTokenExpiringSoon(
	expiresAt: string | number | null | undefined,
	bufferMs: number = 5 * 60 * 1000,
): boolean {
	if (!expiresAt) return false;
	return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}

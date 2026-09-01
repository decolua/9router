/**
 * DevinDesktopExecutor — translates OpenAI chat requests to the direct Devin
 * Desktop Connect-protobuf GetChatMessage stream.
 *
 * The upstream still identifies this client as Windsurf. That compatibility
 * identity is intentionally kept private to this transport.
 */
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { BaseExecutor } from "./base.js";
const DEVIN_DESKTOP_BASE_URL = "https://server.codeium.com";
function sanitizeErrorMessage(value) {
    return String(value ?? "").split(/\r?\n/, 1)[0].slice(0, 4096);
}
function buildErrorBody(status, message) {
    return {
        error: {
            message: sanitizeErrorMessage(message),
            type: status === 401 || status === 403
                ? "authentication_error"
                : status === 429
                    ? "rate_limit_error"
                    : "api_error",
            code: String(status),
        },
    };
}
function mergeUpstreamExtraHeaders(headers, extra) {
    if (!extra || typeof extra !== "object")
        return headers;
    for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined && value !== null)
            headers[key] = String(value);
    }
    return headers;
}
const DEVIN_DESKTOP_CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const DEVIN_DESKTOP_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const DEVIN_DESKTOP_CHAT_URL = `${DEVIN_DESKTOP_BASE_URL}${DEVIN_DESKTOP_CHAT_PATH}`;
const DEVIN_UPSTREAM_IDE_NAME = "windsurf";
const VERIFIED_DEVIN_DESKTOP_VERSION = "3.6.27";
// The installed Desktop bundle exposes codeiumVersion 1.48.2. The exact runtime
// getter has not been independently proven, so keep this distinct from the app
// version and allow a validated override rather than claiming they are equal.
const DEFAULT_DEVIN_EXTENSION_VERSION = "1.48.2";
const DEVIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const DEVIN_LOCALE = "en-US";
const CONNECT_COMPRESSED_FLAG = 0x01;
const CONNECT_END_STREAM_FLAG = 0x02;
const MAX_CONNECT_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_AUTH_RESPONSE_BYTES = 1024 * 1024;
export function resolveDevinDesktopVersion() {
    const override = process.env.DEVIN_DESKTOP_VERSION?.trim() ?? "";
    return DEVIN_VERSION_PATTERN.test(override) ? override : VERIFIED_DEVIN_DESKTOP_VERSION;
}
export function resolveDevinDesktopExtensionVersion() {
    const override = process.env.DEVIN_DESKTOP_EXTENSION_VERSION?.trim() ?? "";
    return DEVIN_VERSION_PATTERN.test(override) ? override : DEFAULT_DEVIN_EXTENSION_VERSION;
}
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
function encodeVarint(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error("invalid protobuf varint");
    const bytes = [];
    let remaining = value;
    while (remaining >= 0x80) {
        bytes.push((remaining % 0x80) | 0x80);
        remaining = Math.floor(remaining / 0x80);
    }
    bytes.push(remaining);
    return Uint8Array.from(bytes);
}
function concatBytes(arrays) {
    const total = arrays.reduce((length, bytes) => length + bytes.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const bytes of arrays) {
        result.set(bytes, offset);
        offset += bytes.length;
    }
    return result;
}
function bodyArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
}
function encodeField(fieldNumber, payload) {
    return concatBytes([encodeVarint((fieldNumber << 3) | 2), encodeVarint(payload.length), payload]);
}
function encodeString(fieldNumber, value) {
    return value ? encodeField(fieldNumber, TEXT_ENCODER.encode(value)) : new Uint8Array(0);
}
function encodeVarintField(fieldNumber, value) {
    return value === 0
        ? new Uint8Array(0)
        : concatBytes([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
}
function encodeMetadata(input) {
    return concatBytes([
        encodeString(1, DEVIN_UPSTREAM_IDE_NAME),
        encodeString(2, input.extensionVersion ?? resolveDevinDesktopExtensionVersion()),
        encodeString(3, input.apiKey),
        encodeString(4, DEVIN_LOCALE),
        encodeString(7, input.ideVersion ?? resolveDevinDesktopVersion()),
        encodeString(10, input.sessionId),
        encodeString(12, DEVIN_UPSTREAM_IDE_NAME),
        encodeString(21, input.userJwt ?? ""),
    ]);
}
/** Encode the unary GetUserJwtRequest (field 1 = Metadata), without an envelope. */
export function encodeDevinDesktopAuthRequest(input) {
    return encodeField(1, encodeMetadata(input));
}
function encodeChatToolCall(toolCall) {
    return concatBytes([
        encodeString(1, toolCall.id),
        encodeString(2, toolCall.name),
        encodeString(3, toolCall.argumentsJson),
    ]);
}
function encodeChatMessagePrompt(prompt) {
    const fields = [
        encodeString(1, prompt.messageId),
        encodeVarintField(2, prompt.source),
        encodeString(3, prompt.prompt),
    ];
    for (const toolCall of prompt.toolCalls ?? []) {
        fields.push(encodeField(6, encodeChatToolCall(toolCall)));
    }
    fields.push(encodeString(7, prompt.toolCallId ?? ""));
    return concatBytes(fields);
}
function encodeChatToolDefinition(tool) {
    return concatBytes([
        encodeString(1, tool.name),
        encodeString(2, tool.description),
        encodeString(3, tool.jsonSchemaString),
        encodeVarintField(12, tool.strict ? 1 : 0),
    ]);
}
function encodeChatToolChoice(choice) {
    return "optionName" in choice
        ? encodeString(1, choice.optionName)
        : encodeString(2, choice.toolName);
}
/** Encode the verified exa.api_server_pb.GetChatMessageRequest wire schema. */
export function encodeDevinDesktopRequest(input) {
    const fields = [
        encodeField(1, encodeMetadata(input)),
        encodeString(2, input.systemPrompt),
    ];
    for (const prompt of input.prompts)
        fields.push(encodeField(3, encodeChatMessagePrompt(prompt)));
    fields.push(encodeVarintField(7, 5)); // CHAT_MESSAGE_REQUEST_TYPE_CASCADE
    for (const tool of input.tools ?? []) {
        fields.push(encodeField(10, encodeChatToolDefinition(tool)));
    }
    if (input.disableParallelToolCalls)
        fields.push(encodeVarintField(11, 1));
    if (input.toolChoice)
        fields.push(encodeField(12, encodeChatToolChoice(input.toolChoice)));
    fields.push(encodeString(14, input.model), encodeString(16, input.cascadeId), encodeString(21, input.model));
    return concatBytes(fields);
}
/** Connect streaming envelope: flags byte plus a big-endian uint32 length. */
export function encodeDevinConnectEnvelope(payload, flags = 0) {
    const frame = new Uint8Array(5 + payload.length);
    frame[0] = flags;
    new DataView(frame.buffer).setUint32(1, payload.length, false);
    frame.set(payload, 5);
    return frame;
}
function messageText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    let text = "";
    for (const part of content) {
        if (part && typeof part === "object" && part.type === "text") {
            text += String(part.text ?? "");
        }
    }
    return text;
}
function convertHistoryToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls))
        return [];
    const result = [];
    for (const toolCall of toolCalls) {
        if (toolCall?.type !== "function" ||
            typeof toolCall.id !== "string" ||
            typeof toolCall.function?.name !== "string" ||
            typeof toolCall.function.arguments !== "string") {
            continue;
        }
        result.push({
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsJson: toolCall.function.arguments,
        });
    }
    return result;
}
function convertMessages(messages) {
    const systemParts = [];
    const prompts = [];
    for (const message of messages) {
        const role = String(message.role || "user");
        const prompt = messageText(message.content);
        if (role === "system" || role === "developer") {
            if (prompt)
                systemParts.push(prompt);
            continue;
        }
        const source = role === "assistant" ? 2 : role === "tool" ? 4 : 1;
        prompts.push({
            messageId: source === 2 ? `bot-${randomUUID()}` : randomUUID(),
            source,
            prompt,
            ...(source === 2 ? { toolCalls: convertHistoryToolCalls(message.tool_calls) } : {}),
            ...(source === 4 && message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
        });
    }
    return { systemPrompt: systemParts.join("\n\n"), prompts };
}
function convertTools(tools) {
    if (!Array.isArray(tools))
        return [];
    const result = [];
    for (const tool of tools) {
        if (tool?.type !== "function" || typeof tool.function?.name !== "string")
            continue;
        result.push({
            name: tool.function.name,
            description: typeof tool.function.description === "string" ? tool.function.description : "",
            jsonSchemaString: JSON.stringify(tool.function.parameters ?? {}),
            strict: tool.function.strict === true,
        });
    }
    return result;
}
function convertToolChoice(choice) {
    if (choice === "auto" || choice === "none" || choice === "required") {
        return { optionName: choice };
    }
    if (!choice || typeof choice !== "object")
        return undefined;
    const record = choice;
    if (record.type !== "function" || !record.function || typeof record.function !== "object") {
        return undefined;
    }
    const name = record.function.name;
    return typeof name === "string" && name ? { toolName: name } : undefined;
}
function readVarint(bytes, start) {
    let value = 0;
    let multiplier = 1;
    let offset = start;
    for (let count = 0; count < 10 && offset < bytes.length; count++) {
        const byte = bytes[offset++];
        value += (byte & 0x7f) * multiplier;
        if (!Number.isSafeInteger(value))
            throw new Error("protobuf varint exceeds safe range");
        if ((byte & 0x80) === 0)
            return [value, offset];
        multiplier *= 0x80;
    }
    throw new Error("truncated protobuf varint");
}
function decodeFields(bytes) {
    const fields = [];
    let offset = 0;
    while (offset < bytes.length) {
        let tag;
        [tag, offset] = readVarint(bytes, offset);
        const fieldNumber = Math.floor(tag / 8);
        const wireType = tag & 0x07;
        if (fieldNumber === 0)
            throw new Error("invalid protobuf field number");
        if (wireType === 0) {
            let value;
            [value, offset] = readVarint(bytes, offset);
            fields.push({ fieldNumber, wireType: 0, value });
            continue;
        }
        if (wireType === 1) {
            if (offset + 8 > bytes.length)
                throw new Error("truncated protobuf fixed64");
            fields.push({ fieldNumber, wireType: 1, value: bytes.slice(offset, offset + 8) });
            offset += 8;
            continue;
        }
        if (wireType === 2) {
            let length;
            [length, offset] = readVarint(bytes, offset);
            if (length > bytes.length - offset)
                throw new Error("truncated protobuf field");
            fields.push({ fieldNumber, wireType: 2, value: bytes.slice(offset, offset + length) });
            offset += length;
            continue;
        }
        if (wireType === 5) {
            if (offset + 4 > bytes.length)
                throw new Error("truncated protobuf fixed32");
            fields.push({ fieldNumber, wireType: 5, value: bytes.slice(offset, offset + 4) });
            offset += 4;
            continue;
        }
        throw new Error(`unsupported protobuf wire type ${wireType}`);
    }
    return fields;
}
function decodeDevinAuthResponse(bytes) {
    const result = { userJwt: "", customApiServerUrl: "" };
    for (const field of decodeFields(bytes)) {
        if (field.wireType !== 2)
            continue;
        if (field.fieldNumber === 1)
            result.userJwt = TEXT_DECODER.decode(field.value);
        else if (field.fieldNumber === 2) {
            // Deliberately decoded but not followed: an unchecked credential-derived
            // URL would create an SSRF path. Enterprise custom endpoints remain a
            // documented limitation until they have a strict validation policy.
            result.customApiServerUrl = TEXT_DECODER.decode(field.value);
        }
    }
    return result;
}
async function readBoundedResponse(response, limit) {
    const reader = response.body?.getReader();
    if (!reader)
        return new Uint8Array(0);
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value?.length)
                continue;
            total += value.length;
            if (total > limit) {
                await reader.cancel("response exceeds safety limit");
                throw new Error("Devin Desktop auth response exceeds the safety limit");
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return concatBytes(chunks);
}
function decodeUsage(bytes) {
    const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
    };
    for (const field of decodeFields(bytes)) {
        if (field.wireType !== 0)
            continue;
        if (field.fieldNumber === 2)
            usage.inputTokens = field.value;
        else if (field.fieldNumber === 3)
            usage.outputTokens = field.value;
        else if (field.fieldNumber === 4)
            usage.cacheWriteTokens = field.value;
        else if (field.fieldNumber === 5)
            usage.cacheReadTokens = field.value;
    }
    return usage;
}
function decodeToolCall(bytes) {
    const result = { id: "", name: "", arguments: "" };
    for (const field of decodeFields(bytes)) {
        if (field.wireType !== 2)
            continue;
        if (field.fieldNumber === 1)
            result.id = TEXT_DECODER.decode(field.value);
        else if (field.fieldNumber === 2)
            result.name = TEXT_DECODER.decode(field.value);
        else if (field.fieldNumber === 3)
            result.arguments = TEXT_DECODER.decode(field.value);
    }
    return result;
}
function decodeGetChatMessageResponse(bytes) {
    const result = {
        text: "",
        thinking: "",
        stopReason: 0,
        usage: null,
        toolCalls: [],
    };
    for (const field of decodeFields(bytes)) {
        if (field.wireType === 2 && field.fieldNumber === 3) {
            result.text += TEXT_DECODER.decode(field.value);
        }
        else if (field.wireType === 0 && field.fieldNumber === 5) {
            result.stopReason = field.value;
        }
        else if (field.wireType === 2 && field.fieldNumber === 6) {
            const toolCall = decodeToolCall(field.value);
            if (toolCall.id)
                result.toolCalls.push(toolCall);
        }
        else if (field.wireType === 2 && field.fieldNumber === 7) {
            result.usage = decodeUsage(field.value);
        }
        else if (field.wireType === 2 && field.fieldNumber === 9) {
            result.thinking += TEXT_DECODER.decode(field.value);
        }
    }
    return result;
}
function parseConnectTrailerError(payload) {
    let parsed;
    try {
        parsed = JSON.parse(TEXT_DECODER.decode(payload).trim() || "{}");
    }
    catch {
        return { code: "invalid_trailer", message: "Invalid Devin Desktop Connect trailer" };
    }
    if (!parsed || typeof parsed !== "object" || !("error" in parsed))
        return null;
    const error = parsed.error;
    if (!error || typeof error !== "object") {
        return { code: "upstream_error", message: "Devin Desktop Connect stream failed" };
    }
    const record = error;
    const code = typeof record.code === "string" ? record.code : "upstream_error";
    const message = typeof record.message === "string" ? record.message : "Connect stream failed";
    return { code, message };
}
function finishReason(stopReason, hasToolCalls) {
    if (hasToolCalls || stopReason === 10)
        return "tool_calls";
    if (stopReason === 3)
        return "length";
    if (stopReason === 11)
        return "content_filter";
    return "stop";
}
function serviceBaseUrl(baseUrl) {
    const normalized = baseUrl.replace(/\/+$/, "");
    for (const path of [DEVIN_DESKTOP_CHAT_PATH, DEVIN_DESKTOP_AUTH_PATH]) {
        if (normalized.endsWith(path))
            return normalized.slice(0, -path.length);
    }
    return normalized;
}
function connectChatUrl(baseUrl) {
    return `${serviceBaseUrl(baseUrl)}${DEVIN_DESKTOP_CHAT_PATH}`;
}
function authUrl(baseUrl) {
    return `${serviceBaseUrl(baseUrl)}${DEVIN_DESKTOP_AUTH_PATH}`;
}
function jsonErrorResponse(status, message) {
    return new Response(JSON.stringify(buildErrorBody(status, message)), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
export class DevinDesktopExecutor extends BaseExecutor {
    constructor() {
        super("devin-desktop", { id: "devin-desktop", baseUrl: DEVIN_DESKTOP_CHAT_URL, timeoutMs: 120000 });
    }
    buildUrl() {
        return DEVIN_DESKTOP_CHAT_URL;
    }
    buildHeaders(_credentials) {
        // The raw imported key authenticates the GetUserJwt preflight through
        // Metadata.api_key; chat then carries both that key and the returned JWT in
        // Metadata. The proven flow does not construct a Basic Authorization header.
        return {
            "Content-Type": "application/connect+proto",
            Accept: "application/connect+proto",
            "Connect-Protocol-Version": "1",
            "Connect-Accept-Encoding": "gzip",
            "User-Agent": `windsurf/${resolveDevinDesktopVersion()}`,
        };
    }
    transformRequest() {
        return null;
    }
    async execute({ model, body, credentials, signal, log, upstreamExtraHeaders, }) {
        const apiKey = credentials.accessToken || credentials.apiKey || "";
        const baseUrl = (credentials?.providerSpecificData?.baseUrl || DEVIN_DESKTOP_BASE_URL);
        const url = connectChatUrl(baseUrl);
        const authEndpoint = authUrl(baseUrl);
        const headers = this.buildHeaders(credentials);
        mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);
        if (!apiKey) {
            return {
                response: jsonErrorResponse(401, "Devin Desktop API key is required"),
                url,
                headers,
                transformedBody: null,
            };
        }
        const requestBody = (body ?? {});
        const messages = Array.isArray(requestBody.messages)
            ? requestBody.messages
            : [];
        const converted = convertMessages(messages);
        if (converted.prompts.length === 0) {
            converted.prompts.push({ messageId: randomUUID(), source: 1, prompt: "" });
        }
        const sessionId = randomUUID();
        const cascadeId = typeof requestBody.conversation_id === "string" && requestBody.conversation_id
            ? requestBody.conversation_id
            : randomUUID();
        const authRequest = encodeDevinDesktopAuthRequest({ apiKey, sessionId });
        const authHeaders = {
            "Content-Type": "application/proto",
            Accept: "*/*",
            "Connect-Protocol-Version": "1",
        };
        mergeUpstreamExtraHeaders(authHeaders, upstreamExtraHeaders);
        let authResponse;
        try {
            authResponse = await fetch(authEndpoint, {
                method: "POST",
                headers: authHeaders,
                body: bodyArrayBuffer(authRequest),
                signal: signal ?? undefined,
            });
        }
        catch (error) {
            const aborted = signal?.aborted === true;
            const safe = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
            log?.warn?.("DEVIN", `Devin Desktop authentication failed: ${safe}`);
            return {
                response: jsonErrorResponse(aborted ? 499 : 502, aborted ? "Devin Desktop request aborted" : "Devin Desktop authentication failed"),
                url: authEndpoint,
                headers: authHeaders,
                transformedBody: null,
            };
        }
        if (!authResponse.ok) {
            void authResponse.body?.cancel().catch(() => { });
            return {
                response: jsonErrorResponse(authResponse.status, `Devin Desktop authentication returned HTTP ${authResponse.status}`),
                url: authEndpoint,
                headers: authHeaders,
                transformedBody: null,
            };
        }
        let userJwt;
        try {
            const authPayload = await readBoundedResponse(authResponse, MAX_AUTH_RESPONSE_BYTES);
            const authData = decodeDevinAuthResponse(authPayload);
            // Do not follow credential-derived custom_api_server_url values without a
            // dedicated allowlist/SSRF policy; the operator-configured base URL remains authoritative.
            userJwt = authData.userJwt;
            if (!userJwt)
                throw new Error("Devin Desktop authentication returned an empty user JWT");
        }
        catch (error) {
            const safe = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
            log?.warn?.("DEVIN", `Devin Desktop authentication response was invalid: ${safe}`);
            return {
                response: jsonErrorResponse(502, `Devin Desktop authentication failed: ${safe}`),
                url: authEndpoint,
                headers: authHeaders,
                transformedBody: null,
            };
        }
        const protobuf = encodeDevinDesktopRequest({
            apiKey,
            userJwt,
            model,
            systemPrompt: converted.systemPrompt,
            prompts: converted.prompts,
            sessionId,
            cascadeId,
            tools: convertTools(requestBody.tools),
            disableParallelToolCalls: requestBody.parallel_tool_calls === false,
            toolChoice: convertToolChoice(requestBody.tool_choice),
        });
        const framed = encodeDevinConnectEnvelope(protobuf);
        log?.info?.("DEVIN", `Devin Desktop → ${model} (${converted.prompts.length} messages)`);
        let upstream;
        try {
            upstream = await fetch(url, {
                method: "POST",
                headers,
                body: bodyArrayBuffer(framed),
                signal: signal ?? undefined,
            });
        }
        catch (error) {
            const aborted = signal?.aborted === true;
            const safe = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
            log?.warn?.("DEVIN", `Devin Desktop Connect request failed: ${safe}`);
            return {
                response: jsonErrorResponse(aborted ? 499 : 502, aborted ? "Devin Desktop request aborted" : "Devin Desktop upstream connection failed"),
                url,
                headers,
                transformedBody: protobuf,
            };
        }
        if (!upstream.ok) {
            void upstream.body?.cancel().catch(() => { });
            return {
                response: jsonErrorResponse(upstream.status, `Devin Desktop upstream returned HTTP ${upstream.status}`),
                url,
                headers,
                transformedBody: protobuf,
            };
        }
        return {
            response: this.transformToSSE(upstream, model),
            url,
            headers,
            transformedBody: protobuf,
        };
    }
    transformToSSE(upstream, model) {
        const responseId = `chatcmpl-devin-desktop-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        let activeReader = null;
        const stream = new ReadableStream({
            async start(controller) {
                const emit = (payload) => {
                    controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(payload)}\n\n`));
                };
                const emitChunk = (delta, reason = null) => {
                    emit({
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [{ index: 0, delta, finish_reason: reason }],
                    });
                };
                const emitError = (message) => {
                    emit(buildErrorBody(502, message, undefined, {
                        type: "devin_desktop_error",
                        code: "upstream_error",
                    }));
                    controller.enqueue(TEXT_ENCODER.encode("data: [DONE]\n\n"));
                };
                let pending = new Uint8Array(0);
                let roleEmitted = false;
                let stopReason = 0;
                const toolCallIndexes = new Map();
                let usage = null;
                let trailerError = null;
                let sawEndStream = false;
                try {
                    activeReader = upstream.body?.getReader() ?? null;
                    if (!activeReader)
                        throw new Error("Devin Desktop response body is empty");
                    const handleFrame = (flags, payload) => {
                        if ((flags & ~(CONNECT_COMPRESSED_FLAG | CONNECT_END_STREAM_FLAG)) !== 0) {
                            throw new Error("Invalid Devin Desktop Connect frame flags");
                        }
                        const decodedPayload = flags & CONNECT_COMPRESSED_FLAG
                            ? gunzipSync(payload, { maxOutputLength: MAX_CONNECT_FRAME_BYTES })
                            : payload;
                        if (flags & CONNECT_END_STREAM_FLAG) {
                            if (sawEndStream)
                                throw new Error("Duplicate Devin Desktop Connect end-stream frame");
                            sawEndStream = true;
                            trailerError = parseConnectTrailerError(decodedPayload);
                            return true;
                        }
                        const response = decodeGetChatMessageResponse(decodedPayload);
                        stopReason = response.stopReason || stopReason;
                        usage = response.usage ?? usage;
                        if ((response.thinking || response.text || response.toolCalls.length) && !roleEmitted) {
                            emitChunk({ role: "assistant", content: "" });
                            roleEmitted = true;
                        }
                        if (response.thinking)
                            emitChunk({ reasoning_content: response.thinking });
                        if (response.text)
                            emitChunk({ content: response.text });
                        for (const toolCall of response.toolCalls) {
                            const existingIndex = toolCallIndexes.get(toolCall.id);
                            const index = existingIndex ?? toolCallIndexes.size;
                            const firstDelta = existingIndex === undefined;
                            if (firstDelta)
                                toolCallIndexes.set(toolCall.id, index);
                            const functionDelta = {};
                            if (toolCall.name)
                                functionDelta.name = toolCall.name;
                            if (toolCall.arguments)
                                functionDelta.arguments = toolCall.arguments;
                            emitChunk({
                                tool_calls: [
                                    {
                                        index,
                                        ...(firstDelta ? { id: toolCall.id, type: "function" } : {}),
                                        function: functionDelta,
                                    },
                                ],
                            });
                        }
                        return false;
                    };
                    const drain = () => {
                        let offset = 0;
                        while (pending.length - offset >= 5) {
                            const length = new DataView(pending.buffer, pending.byteOffset + offset + 1, 4).getUint32(0, false);
                            if (length > MAX_CONNECT_FRAME_BYTES) {
                                throw new Error("Devin Desktop Connect frame exceeds the safety limit");
                            }
                            if (pending.length - offset < 5 + length)
                                break;
                            const flags = pending[offset];
                            const terminal = handleFrame(flags, pending.slice(offset + 5, offset + 5 + length));
                            offset += 5 + length;
                            if (terminal) {
                                if (pending.length !== offset) {
                                    throw new Error("Data follows the Devin Desktop Connect end-stream frame");
                                }
                                pending = new Uint8Array(0);
                                return true;
                            }
                        }
                        if (offset > 0)
                            pending = pending.slice(offset);
                        return false;
                    };
                    while (true) {
                        const { done, value } = await activeReader.read();
                        if (value?.length) {
                            pending = pending.length ? concatBytes([pending, value]) : Uint8Array.from(value);
                            if (drain()) {
                                await activeReader.cancel("Devin Desktop Connect end-stream received");
                                break;
                            }
                        }
                        if (done)
                            break;
                    }
                    if (!sawEndStream)
                        drain();
                    if (pending.length !== 0)
                        throw new Error("Truncated Devin Desktop Connect frame");
                    if (!sawEndStream)
                        throw new Error("Devin Desktop Connect stream ended without trailers");
                    if (trailerError) {
                        const detail = sanitizeErrorMessage(`${trailerError.code}: ${trailerError.message}`);
                        emitError(`Devin Desktop stream error: ${detail}`);
                        return;
                    }
                    const finalPayload = {
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: finishReason(stopReason, toolCallIndexes.size > 0),
                            },
                        ],
                    };
                    if (usage) {
                        finalPayload.usage = {
                            prompt_tokens: usage.inputTokens,
                            completion_tokens: usage.outputTokens,
                            total_tokens: usage.inputTokens + usage.outputTokens,
                            prompt_tokens_details: { cached_tokens: usage.cacheReadTokens },
                            cache_write_tokens: usage.cacheWriteTokens,
                        };
                    }
                    emit(finalPayload);
                    controller.enqueue(TEXT_ENCODER.encode("data: [DONE]\n\n"));
                }
                catch (error) {
                    try {
                        await activeReader?.cancel("Devin Desktop Connect stream failed");
                    }
                    catch {
                        // Preserve the original protocol/decode error below.
                    }
                    const safe = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
                    emitError(`Devin Desktop stream error: ${safe}`);
                }
                finally {
                    activeReader?.releaseLock();
                    activeReader = null;
                    controller.close();
                }
            },
            async cancel(reason) {
                await activeReader?.cancel(reason);
            },
        });
        return new Response(stream, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    }
}

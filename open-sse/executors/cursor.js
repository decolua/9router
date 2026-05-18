import { BaseExecutor } from "./base.js"
import { PROVIDERS } from "../config/providers.js"
import { HTTP_STATUS } from "../config/runtimeConfig.js"
import {
  generateCursorBody,
  parseConnectRPCFrame,
  extractTextFromResponse
} from "../utils/cursorProtobuf.js"
import { buildCursorHeaders } from "../utils/cursorChecksum.js"
import { estimateUsage } from "../utils/usageTracking.js"
import { FORMATS } from "../translator/formats.js"
import { proxyAwareFetch } from "../utils/proxyFetch.js"
import zlib from "zlib"

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true
  if (typeof EdgeRuntime !== "undefined") return true
  return false
}

// Lazy import http2 (only in Node.js environment)
let http2 = null
if (!isCloudEnv()) {
  try {
    http2 = await import("http2")
  } catch {
    // http2 not available
  }
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
}

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1"
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args)
}

function decompressPayload(payload, flags) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8")
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`)
        return payload
      }
    } catch { }
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload)
    } catch (gzipErr) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload)
      } catch (deflateErr) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload)
        } catch (rawErr) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipErr.message}, deflate=${deflateErr.message}, raw=${rawErr.message}`
          )
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          )
          return payload
        }
      }
    }
  }
  return payload
}

// Detect Cursor "not logged in" / auth failures so chatCore's 401/403 branch
// can run the standard refresh-and-retry flow. Cursor reports these as HTTP
// 400 with code=ERROR_NOT_LOGGED_IN, which would otherwise bypass refresh.
function isCursorAuthError(text) {
  if (!text || typeof text !== "string") return false
  return /ERROR_NOT_LOGGED_IN|ERROR_UNAUTHORIZED|Authentication error/i.test(text)
}

function createErrorResponse(jsonError) {
  const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
    || jsonError?.error?.details?.[0]?.debug?.details?.detail
    || jsonError?.error?.message
    || "API Error"

  const code = jsonError?.error?.code
    || jsonError?.error?.details?.[0]?.debug?.error
    || ""

  const isRateLimit = code === "resource_exhausted"
  const isAuth = isCursorAuthError(code) || isCursorAuthError(errorMsg)

  let status
  let type
  if (isAuth) {
    status = HTTP_STATUS.UNAUTHORIZED
    type = "authentication_error"
  } else if (isRateLimit) {
    status = HTTP_STATUS.RATE_LIMITED
    type = "rate_limit_error"
  } else {
    status = HTTP_STATUS.BAD_REQUEST
    type = "api_error"
  }

  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type,
      code: jsonError?.error?.details?.[0]?.debug?.details?.error || jsonError?.error?.details?.[0]?.debug?.error || code || "unknown"
    }
  }), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor)
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken
    const machineId = credentials.providerSpecificData?.machineId
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API")
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode)
  }

  transformRequest(model, body, stream, credentials) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call buildCursorRequest again — double-translation drops tool_results
    const messages = body.messages || []
    const tools = body.tools || []
    const reasoningEffort = body.reasoning_effort || null
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = credentials?.rawHeaders?.["user-agent"] || ""
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code")
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode)
  }

  async makeFetchRequest(url, headers, body, signal, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body,
      signal
    }, proxyOptions)

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    }
  }

  makeHttp2Request(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available")
    }

    const HTTP2_TIMEOUT_MS = 60000 // 60s max — prevent hung sessions

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const client = http2.connect(`https://${urlObj.host}`)
      const chunks = []
      let responseHeaders = {}
      let settled = false

      // Ensure client is always closed on settle
      const finish = (fn) => (...args) => {
        if (settled) return
        settled = true
        clearTimeout(hangTimeout)
        client.close()
        fn(...args)
      }

      // Hard timeout: close session if server never responds
      const hangTimeout = setTimeout(finish(() => {
        reject(new Error("HTTP/2 request timed out"))
      }), HTTP2_TIMEOUT_MS)

      client.on("error", finish(reject))

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      })

      req.on("response", (hdrs) => { responseHeaders = hdrs })
      req.on("data", (chunk) => { chunks.push(chunk) })
      req.on("end", finish(() => {
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        })
      }))
      req.on("error", finish(reject))

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")))
        signal.addEventListener("abort", onAbort, { once: true })
      }

      req.write(body)
      req.end()
    })
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl()
    const headers = this.buildHeaders(credentials)
    const transformedBody = this.transformRequest(model, body, stream, credentials)

    try {
      const shouldForceFetch = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true || !!proxyOptions?.vercelRelayUrl
      const response = (http2 && !shouldForceFetch)
        ? await this.makeHttp2Request(url, headers, transformedBody, signal)
        : await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions)

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error"
        // Remap Cursor's "not logged in" (delivered as HTTP 400) to 401 so the
        // shared chatCore 401/403 branch can drive refreshCredentials + retry.
        const remappedStatus = (response.status === 400 && isCursorAuthError(errorText))
          ? HTTP_STATUS.UNAUTHORIZED
          : response.status
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${errorText}`,
            type: remappedStatus === HTTP_STATUS.UNAUTHORIZED ? "authentication_error" : "invalid_request_error",
            code: ""
          }
        }), {
          status: remappedStatus,
          headers: { "Content-Type": "application/json" }
        })
        return { response: errorResponse, url, headers, transformedBody: body }
      }

      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model, body)
        : this.transformProtobufToJSON(response.body, model, body)

      return { response: transformedResponse, url, headers, transformedBody: body }
    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      })
      return { response: errorResponse, url, headers, transformedBody: body }
    }
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    let offset = 0
    let totalContent = ""
    const toolCalls = []
    const toolCallsMap = new Map() // Track streaming tool calls by ID
    const finalizedIds = new Set()
    let frameCount = 0

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`)

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) {
        debugLog(
          `[CURSOR BUFFER] Reached end, offset=${offset}, remaining=${buffer.length - offset}`
        )
        break
      }

      const flags = buffer[offset]
      const length = buffer.readUInt32BE(offset + 1)

      debugLog(
        `[CURSOR BUFFER] Frame ${frameCount + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`
      )

      if (offset + 5 + length > buffer.length) {
        debugLog(
          `[CURSOR BUFFER] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`
        )
        break
      }

      let payload = buffer.slice(offset + 5, offset + 5 + length)
      offset += 5 + length
      frameCount++

      payload = decompressPayload(payload, flags)
      if (!payload) {
        debugLog(`[CURSOR BUFFER] Frame ${frameCount}: decompression failed, skipping`)
        continue
      }

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8")
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            )
            if (hasContent) {
              break
            }
            return createErrorResponse(JSON.parse(text))
          }
        } catch { }
      }

      const result = extractTextFromResponse(new Uint8Array(payload))
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result)

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`)
        if (hasContent) {
          break
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        )
      }

      if (result.toolCall) {
        const tc = result.toolCall

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id)
          existing.function.arguments += tc.function.arguments
          existing.isLast = tc.isLast
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc })
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id)
          finalizedIds.add(tc.id)
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          })
        }
      }

      if (result.text) totalContent += result.text
    }

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    )

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`)
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        })
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`)


    const message = {
      role: "assistant",
      content: totalContent || null
    }

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI)

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    }

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }

  transformProtobufToSSE(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    const chunks = []
    let offset = 0
    let totalContent = ""
    const toolCalls = []
    const toolCallsMap = new Map() // Track streaming tool calls by ID
    const finalizedIds = new Set()
    const emittedToolCallIds = new Set()
    let frameCount = 0

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`)

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) {
        debugLog(
          `[CURSOR BUFFER SSE] Reached end, offset=${offset}, remaining=${buffer.length - offset}`
        )
        break
      }

      const flags = buffer[offset]
      const length = buffer.readUInt32BE(offset + 1)

      debugLog(
        `[CURSOR BUFFER SSE] Frame ${frameCount + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`
      )

      if (offset + 5 + length > buffer.length) {
        debugLog(
          `[CURSOR BUFFER SSE] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`
        )
        break
      }

      let payload = buffer.slice(offset + 5, offset + 5 + length)
      offset += 5 + length
      frameCount++

      payload = decompressPayload(payload, flags)
      if (!payload) {
        debugLog(`[CURSOR BUFFER SSE] Frame ${frameCount}: decompression failed, skipping`)
        continue
      }

      // Check for JSON error frames (byte-guard: only decode if starts with '{')
      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8")
          if (text.includes('"error"')) {
            const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0
            debugLog(
              `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            )
            if (hasContent) {
              break
            }
            return createErrorResponse(JSON.parse(text))
          }
        } catch { }
      }

      const result = extractTextFromResponse(new Uint8Array(payload))
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result)

      if (result.error) {
        const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0
        debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`)
        if (hasContent) {
          break
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        )
      }

      if (result.toolCall) {
        const tc = result.toolCall

        if (chunks.length === 0) {
          chunks.push(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null
                }
              ]
            })}\n\n`
          )
        }

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id)
          const oldArgsLen = existing.function.arguments.length
          existing.function.arguments += tc.function.arguments
          existing.isLast = tc.isLast

          // Stream the delta arguments
          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id)
            chunks.push(
              `data: ${JSON.stringify({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: existing.index,
                          id: tc.id,
                          type: "function",
                          function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments
                          }
                        }
                      ]
                    },
                    finish_reason: null
                  }
                ]
              })}\n\n`
            )
          }
        } else {
          // New tool call - assign index and add to map
          const toolCallIndex = toolCalls.length
          finalizedIds.add(tc.id)
          toolCalls.push({ ...tc, index: toolCallIndex })
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex })

          // Stream initial tool call with name
          emittedToolCallIds.add(tc.id)
          chunks.push(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments
                        }
                      }
                    ]
                  },
                  finish_reason: null
                }
              ]
            })}\n\n`
          )
        }
      }

      if (result.text) {
        totalContent += result.text
        chunks.push(
          `data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta:
                  chunks.length === 0 && toolCalls.length === 0
                    ? { role: "assistant", content: result.text }
                    : { content: result.text },
                finish_reason: null
              }
            ]
          })}\n\n`
        )
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`
    )

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`)
        const toolCallIndex = toolCalls.length
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        })

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments
                        }
                      }
                    ]
                  },
                  finish_reason: null
                }
              ]
            })}\n\n`
          )
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(
        `data: ${JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null
            }
          ]
        })}\n\n`
      )
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI)

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
          }
        ],
        usage
      })}\n\n`
    )
    chunks.push("data: [DONE]\n\n")

    return new Response(chunks.join(""), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    })
  }

  /**
   * Refresh Cursor access token.
   *
   * Supported strategy:
   *   - API key flow (authMethod === "apikey"): re-exchange the long-lived
   *     Cursor API key (`key_...`) at POST /auth/exchange_user_api_key.
   *     This mirrors what cursor-agent CLI does internally.
   *
   * Legacy IDE-import flow (authMethod === "imported") has no refresh path —
   * the user must re-run auto-import while Cursor IDE is logged in.
   */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const psd = credentials?.providerSpecificData || {}
    const apiKey = psd.apiKey
    if (!apiKey) return null

    try {
      const res = await proxyAwareFetch(
        "https://api2.cursor.sh/auth/exchange_user_api_key",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: "{}",
        },
        proxyOptions
      )

      if (!res.ok) {
        log?.warn?.("TOKEN", `Cursor exchange_user_api_key failed: HTTP ${res.status}`)
        return null
      }

      const data = await res.json()
      const accessToken = data?.accessToken
      if (!accessToken) {
        log?.warn?.("TOKEN", "Cursor exchange response missing accessToken")
        return null
      }

      let expiresIn = 3600
      try {
        const exp = JSON.parse(
          Buffer.from(accessToken.split(".")[1], "base64").toString()
        ).exp
        if (Number.isFinite(exp)) {
          expiresIn = Math.max(60, exp - Math.floor(Date.now() / 1000))
        }
      } catch {
        // Non-JWT token; keep default expiresIn
      }

      log?.info?.("TOKEN", "Cursor refreshed via API key")

      return {
        accessToken,
        refreshToken: data.refreshToken || credentials.refreshToken || null,
        expiresIn,
        // Preserve machineId / apiKey / authMethod / ghostMode
        providerSpecificData: { ...psd },
      }
    } catch (e) {
      log?.error?.("TOKEN", `Cursor refresh error: ${e.message}`)
      return null
    }
  }
}

export default CursorExecutor

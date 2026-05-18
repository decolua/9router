/**
 * Protobuf message builders and parsers for the local Windsurf language server.
 *
 * Service: exa.language_server_pb.LanguageServerService
 *
 * Two flows:
 *   Legacy  → RawGetChatMessage (streaming, simpler)
 *   Cascade → StartCascade → SendUserCascadeMessage → poll GetCascadeTrajectorySteps
 *
 * ═══════════════════════════════════════════════════════════
 * Metadata {
 *   string ide_name          = 1;
 *   string extension_version = 2;
 *   string api_key           = 3;
 *   string locale            = 4;
 *   string os                = 5;
 *   string ide_version       = 7;
 *   string hardware          = 8;
 *   uint64 request_id        = 9;
 *   string session_id        = 10;
 *   string extension_name    = 12;
 * }
 *
 * RawGetChatMessageRequest {
 *   Metadata metadata                = 1;
 *   repeated ChatMessage messages    = 2;
 *   string system_prompt_override    = 3;
 *   Model chat_model                 = 4;   // enum
 *   string chat_model_name           = 5;
 * }
 *
 * ChatMessage {
 *   string message_id                = 1;
 *   ChatMessageSource source         = 2;   // enum
 *   Timestamp timestamp              = 3;
 *   string conversation_id           = 4;
 *   ChatMessageIntent intent         = 5;   // for user/system/tool
 *   // For assistant: field 5 is plain string text
 * }
 *
 * ChatMessageIntent { IntentGeneric generic = 1; }
 * IntentGeneric { string text = 1; }
 *
 * RawGetChatMessageResponse {
 *   RawChatMessage delta_message = 1;
 * }
 *
 * RawChatMessage {
 *   string message_id       = 1;
 *   ChatMessageSource source = 2;
 *   Timestamp timestamp     = 3;
 *   string conversation_id  = 4;
 *   string text             = 5;
 *   bool in_progress        = 6;
 *   bool is_error           = 7;
 * }
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'crypto';
import {
  writeVarintField, writeStringField, writeMessageField, writeBytesField,
  writeBoolField, parseFields, getField, getAllFields,
} from './proto.js';
import { getSystemPrompts } from './runtime-config.js';

// ─── Enums ─────────────────────────────────────────────────

export const SOURCE = {
  USER: 1,
  SYSTEM: 2,
  ASSISTANT: 3,
  TOOL: 4,
};

// ─── Timestamp ─────────────────────────────────────────────

function encodeTimestamp() {
  const now = Date.now();
  const secs = Math.floor(now / 1000);
  const nanos = (now % 1000) * 1_000_000;
  const parts = [writeVarintField(1, secs)];
  if (nanos > 0) parts.push(writeVarintField(2, nanos));
  return Buffer.concat(parts);
}

// ─── Metadata ──────────────────────────────────────────────

import { platform, arch } from 'os';
const _os = platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : 'linux';
const _hw = arch() === 'arm64' ? 'arm64' : 'x86_64';
const DEFAULT_CLIENT_VERSION = process.env.WINDSURF_CLIENT_VERSION || '2.0.67';

export function buildMetadata(apiKey, version = DEFAULT_CLIENT_VERSION, sessionId = null) {
  return Buffer.concat([
    writeStringField(1, 'windsurf'),          // ide_name
    writeStringField(2, version),             // extension_version
    writeStringField(3, apiKey),              // api_key
    writeStringField(4, 'en'),                // locale
    writeStringField(5, _os),                 // os
    writeStringField(7, version),             // ide_version
    writeStringField(8, _hw),                 // hardware
    writeVarintField(9, Math.floor(Math.random() * 2**48)),  // request_id
    writeStringField(10, sessionId || randomUUID()), // session_id
    writeStringField(12, 'windsurf'),          // extension_name
  ]);
}

// ─── ChatMessage (for RawGetChatMessage) ───────────────────

function buildChatMessage(content, source, conversationId) {
  const parts = [
    writeStringField(1, randomUUID()),                     // message_id
    writeVarintField(2, source),                           // source enum
    writeMessageField(3, encodeTimestamp()),                // timestamp
    writeStringField(4, conversationId),                   // conversation_id
  ];

  if (source === SOURCE.ASSISTANT) {
    // Assistant goes in ChatMessage.action (field 6), not .intent (field 5).
    // Proto: ChatMessageAction { ChatMessageActionGeneric generic = 1; }
    //        ChatMessageActionGeneric { string text = 1; }
    // Previous code wrote a raw string into field 5 which happens to share
    // wire type (length-delimited) with the expected message, so short
    // replies slipped through parsing by coincidence — real multi-turn
    // conversations tripped the LS with "invalid wire-format data".
    const actionGeneric = writeStringField(1, content);    // ChatMessageActionGeneric.text
    const action = writeMessageField(1, actionGeneric);    // ChatMessageAction.generic
    parts.push(writeMessageField(6, action));
  } else {
    // User/System/Tool use ChatMessageIntent { IntentGeneric { text } }
    const intentGeneric = writeStringField(1, content);    // IntentGeneric.text
    const intent = writeMessageField(1, intentGeneric);    // ChatMessageIntent.generic
    parts.push(writeMessageField(5, intent));
  }

  return Buffer.concat(parts);
}

// ─── RawGetChatMessageRequest ──────────────────────────────

/**
 * Build RawGetChatMessageRequest protobuf.
 *
 * @param {string} apiKey
 * @param {Array} messages - OpenAI-format [{role, content}, ...]
 * @param {number} modelEnum - Windsurf model enum value
 * @param {string} [modelName] - Model name string (optional)
 */
export function buildRawGetChatMessageRequest(apiKey, messages, modelEnum, modelName, sessionId = null) {
  const parts = [];
  const conversationId = randomUUID();

  // Field 1: Metadata — pass through the caller's session id so the
  // legacy Raw channel uses the same per-LS session as Cascade instead
  // of a fresh UUID per request (anti-fingerprint).
  parts.push(writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)));

  // Field 2: repeated ChatMessage (skip system, handled separately).
  // Windsurf's legacy RawGetChatMessage backend rejects role=tool and
  // doesn't know about assistant tool_calls. Degrade both to plain text
  // so multi-turn conversations that carry tool history still flow
  // through without triggering "proto: cannot parse invalid wire-format
  // data" upstream. Cascade models are unaffected — they use a different
  // endpoint (SendUserCascadeMessage) with full tool support.
  let systemPrompt = '';
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n' : '') +
        (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      continue;
    }

    let source;
    let text;
    const baseText = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : msg.content == null ? '' : JSON.stringify(msg.content);

    switch (msg.role) {
      case 'user':
        source = SOURCE.USER;
        text = baseText;
        break;
      case 'assistant':
        source = SOURCE.ASSISTANT;
        // If the assistant previously called tools, append the call descriptions
        // so the model sees its own prior tool usage as text. Empty string OK.
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
          const tcLines = msg.tool_calls.map(tc =>
            `[called tool ${tc.function?.name || 'unknown'} with ${tc.function?.arguments || '{}'}]`
          ).join('\n');
          text = baseText ? `${baseText}\n${tcLines}` : tcLines;
        } else {
          text = baseText;
        }
        break;
      case 'tool':
        // Rewrite tool-result turn as a synthetic user utterance so the
        // server-side schema accepts it.
        source = SOURCE.USER;
        text = `[tool result${msg.tool_call_id ? ` for ${msg.tool_call_id}` : ''}]: ${baseText}`;
        break;
      default:
        source = SOURCE.USER;
        text = baseText;
    }

    parts.push(writeMessageField(2, buildChatMessage(text, source, conversationId)));
  }

  // Field 3: system_prompt_override
  if (systemPrompt) {
    parts.push(writeStringField(3, systemPrompt));
  }

  // Field 4: model enum
  parts.push(writeVarintField(4, modelEnum));

  // Field 5: chat_model_name
  if (modelName) {
    parts.push(writeStringField(5, modelName));
  }

  return Buffer.concat(parts);
}

// ─── RawGetChatMessageResponse parser ──────────────────────

/**
 * Parse a RawGetChatMessageResponse → extract text from RawChatMessage.
 *
 * RawGetChatMessageResponse { RawChatMessage delta_message = 1; }
 * RawChatMessage { ..., string text = 5, bool in_progress = 6, bool is_error = 7 }
 */
export function parseRawResponse(buf) {
  const fields = parseFields(buf);
  const f1 = getField(fields, 1, 2); // delta_message
  if (!f1) return { text: '' };

  const inner = parseFields(f1.value);
  const text = getField(inner, 5, 2);
  const inProgress = getField(inner, 6, 0);
  const isError = getField(inner, 7, 0);

  return {
    text: text ? text.value.toString('utf8') : '',
    inProgress: inProgress ? !!inProgress.value : false,
    isError: isError ? !!isError.value : false,
  };
}

// ─── Panel initialization ─────────────────────────────────

/**
 * Build InitializeCascadePanelStateRequest.
 * Required before Cascade flow — initializes the panel state in the language server.
 *
 * Field 1: metadata
 * Field 2: ExtensionPanelTab enum (4 = CORTEX)
 */
// Field numbers verified by extracting the FileDescriptorProto from
// language_server_linux_x64. Historical layouts are NOT the same — field 2 of
// InitializeCascadePanelState is reserved; workspace_trusted moved to field 3.
export function buildInitializePanelStateRequest(apiKey, sessionId, trusted = true) {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(3, trusted), // workspace_trusted
  ]);
}

// HeartbeatRequest { metadata = 1; previous_error_traces = 2; experiment_config = 3 deprecated }.
export function buildHeartbeatRequest(apiKey, sessionId) {
  return writeMessageField(1, buildMetadata(apiKey, undefined, sessionId));
}

// AddTrackedWorkspaceRequest has a single field: workspace (string, filesystem path).
export function buildAddTrackedWorkspaceRequest(workspacePath) {
  return writeStringField(1, workspacePath);
}

// UpdateWorkspaceTrustRequest { metadata=1, workspace_trusted=2 }. No path — trust is global.
export function buildUpdateWorkspaceTrustRequest(apiKey, _ignored, trusted = true, sessionId) {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(2, trusted),
  ]);
}

export function buildUpdatePanelStateWithUserStatusRequest(apiKey, sessionId, userStatusBytes) {
  const parts = [
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
  ];
  if (userStatusBytes?.length) {
    parts.push(writeMessageField(2, userStatusBytes));
  }
  return Buffer.concat(parts);
}

// ─── Cascade flow builders ─────────────────────────────────

/**
 * Build StartCascadeRequest.
 * Field 1: metadata
 */
export function buildStartCascadeRequest(apiKey, sessionId) {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeVarintField(4, 1),  // source = CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT
    writeVarintField(5, 1),  // trajectory_type = CORTEX_TRAJECTORY_TYPE_USER_MAINLINE
  ]);
}

/**
 * Build SendUserCascadeMessageRequest.
 *
 * Field 1: cascade_id
 * Field 2: items (TextOrScopeItem { text = 1 })
 * Field 3: metadata
 * Field 5: cascade_config
 * Field 6: images (repeated ImageData)
 * Field 9: additional_steps (repeated CortexTrajectoryStep) — used by the
 *          v2.0.65 native tool bridge to inject "the caller already ran
 *          tool X with result Y" into the trajectory before the planner
 *          sees the next user turn. See src/cascade-native-bridge.js.
 */
export function buildSendCascadeMessageRequest(apiKey, cascadeId, text, modelEnum, modelUid, sessionId, { toolPreamble, images, additionalSteps, nativeMode, nativeAllowlist } = {}) {
  const parts = [];

  // Field 1: cascade_id
  parts.push(writeStringField(1, cascadeId));

  // Field 2: TextOrScopeItem { text = 1 }
  parts.push(writeMessageField(2, writeStringField(1, text)));

  // Field 3: metadata
  parts.push(writeMessageField(3, buildMetadata(apiKey, undefined, sessionId)));

  // Field 5: cascade_config
  // DEFAULT mode enables vision but also activates Cascade's built-in tools
  // which conflict with our emulated tools. We force DEFAULT in two cases:
  //   - vision: images are attached AND no client tools are present.
  //   - native bridge: the caller's tools[] all map onto cascade-native
  //     IDE tools and v2.0.65 wants the planner's IDE agent loop alive
  //     (see src/cascade-native-bridge.js for rationale).
  const forceDefault = !!nativeMode || (!!images?.length && !toolPreamble);
  // v2.0.66 partition mode: when nativeMode is on AND a non-empty
  // toolPreamble was provided, the caller has unmapped tools that need
  // emulation alongside the mapped-tool native bridge. Pass toolPreamble
  // through so additional_instructions_section still carries those tool
  // definitions even though planner_mode is DEFAULT.
  const cascadeConfig = buildCascadeConfig(modelEnum, modelUid, {
    toolPreamble: toolPreamble || '',
    forceDefault,
    nativeMode: !!nativeMode,
    nativeAllowlist: nativeAllowlist || null,
  });
  parts.push(writeMessageField(5, cascadeConfig));

  // Field 6: images — repeated ImageData { base64_data=1, mime_type=2 }
  if (images?.length) {
    for (const img of images) {
      const imgMsg = Buffer.concat([
        writeStringField(1, img.base64_data),
        writeStringField(2, img.mime_type || 'image/png'),
      ]);
      parts.push(writeMessageField(6, imgMsg));
    }
  }

  // Field 9: additional_steps — repeated CortexTrajectoryStep. The native
  // bridge fills this with "we already executed view_file/run_command/...
  // and here are the results" steps so the planner reasons from the
  // post-tool state directly.
  if (Array.isArray(additionalSteps) && additionalSteps.length) {
    for (const stepBuf of additionalSteps) {
      if (!stepBuf || !Buffer.isBuffer(stepBuf) || stepBuf.length === 0) continue;
      parts.push(writeMessageField(9, stepBuf));
    }
  }

  return Buffer.concat(parts);
}

function buildCascadeConfig(modelEnum, modelUid, { toolPreamble, forceDefault, nativeMode, nativeAllowlist } = {}) {
  // CascadeConversationalPlannerConfig.planner_mode (field 4) uses
  // codeium_common.ConversationalPlannerMode:
  //   0 UNSPECIFIED  1 DEFAULT  2 READ_ONLY  3 NO_TOOL
  //   4 EXPLORE      5 PLANNING 6 AUTO
  //
  // Default: NO_TOOL (3). DEFAULT keeps the IDE agent loop alive, which
  // is exactly the behaviour the v2.0.65 native bridge wants — the planner
  // reflexively proposes view_file / run_command / grep_search_v2 / find,
  // and the bridge translates those proposals back into OpenAI tool_calls
  // for the caller to execute. Without the bridge, DEFAULT mode produced:
  //   - stall_warm bursts (15–25s silent tool-execution trajectory steps)
  //   - "Cascade cannot create /tmp/windsurf-workspace/foo because it
  //     already exists" on request bursts that reuse the same filename
  //   - /tmp/windsurf-workspace path leaks inside the chat body
  // The bridge tames these by (a) populating CascadeToolConfig.tool_allowlist
  // so only the kinds the caller actually has are enabled, (b) injecting
  // observation steps via additional_steps[9] so the planner doesn't
  // re-execute server-side, (c) ALWAYS sanitising paths on the way out.
  //
  // When toolPreamble is provided (NO_TOOL emulation path), we inject it
  // into the system prompt's tool_calling_section via SectionOverrideConfig
  // (OVERRIDE mode). This is far more reliable than user-message injection
  // because NO_TOOL mode's system prompt tells the model "you have no
  // tools" — which overpowers anything we put in the user message. The
  // section override replaces that section directly so the model sees our
  // emulated tool definitions at the system-prompt level.
  //
  // Mode selection:
  //   nativeMode=true  → DEFAULT (1) + tool_allowlist
  //   forceDefault=true (vision) → DEFAULT (1) without bridge config
  //   else → NO_TOOL (3) + tool preamble in section overrides
  const mode = (nativeMode || forceDefault) ? 1 : 3;
  const convParts = [writeVarintField(4, mode)];

  // ── System prompt section overrides ──────────────────────────────────
  //
  // CascadeConversationalPlannerConfig section override fields:
  //   field 10: tool_calling_section
  //   field 12: additional_instructions_section
  //
  // Key insight: NO_TOOL mode (planner_mode=3) SUPPRESSES the
  // tool_calling_section entirely — SectionOverrideConfig on field 10 is
  // injected but never rendered to the model. Verified 2026-04-12: even
  // with OVERRIDE mode on field 10, the model said "I don't have access
  // to tools" and ignored the emulated definitions.
  //
  // We deliver tool definitions exclusively via
  // additional_instructions_section (field 12, OVERRIDE) which IS
  // rendered regardless of planner mode. The earlier code also wrote the
  // same blob to field 10 as belt-and-suspenders, but with a 30+ tool
  // Claude Code request that doubled the proto-level system payload and
  // pushed total LS panel state past the ~30KB ceiling — directly causing
  // the "tools work locally but not in cloud" symptom users reported.
  // Field 10 is now intentionally left untouched.
  if (toolPreamble) {
    // ── Client provided OpenAI tools[] ──
    // Primary (and only) delivery: additional_instructions_section
    // (field 12, OVERRIDE). Always rendered, even in NO_TOOL planner mode.
    const sp = getSystemPrompts();
    const reinforcement = '\n\n' + sp.toolReinforcement;
    const fullSection = toolPreamble + reinforcement;
    const additionalSection = Buffer.concat([
      writeVarintField(1, 1),             // SECTION_OVERRIDE_MODE_OVERRIDE
      writeStringField(2, fullSection),
    ]);
    convParts.push(writeMessageField(12, additionalSection));
    // v2.0.70 — diagnostic dump for #115 root-cause work. When
    // WINDSURFAPI_DUMP_SYSTEM_PROMPT=1, write the EXACT additional_
    // instructions_section payload to a per-LS-port file under /tmp so
    // we can inspect what GPT actually sees when partition mode +
    // emulation toolPreamble are in play. Only first 4KB to keep the
    // file tail-able.
    if (process.env.WINDSURFAPI_DUMP_SYSTEM_PROMPT === '1') {
      try {
        // Lazy-import fs to avoid pulling it into hot paths when off.
        // eslint-disable-next-line no-undef
        import('fs').then(fs => {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const path = `/tmp/windsurf-sp-dump-${ts}.txt`;
          fs.writeFileSync(path, fullSection.slice(0, 4096) + '\n--- end ---\n');
        }).catch(() => {});
      } catch {}
    }

    // field 13 (communication_section): minimal override.
    // DO NOT include any identity manipulation instructions here — Cascade's
    // anti-injection system detects "adopt identity X / don't call yourself Y"
    // as prompt injection and refuses the entire request. (#22)
    // Let Cascade keep its baked-in identity; tool emulation still works via
    // field 12 (additional_instructions_section).
    const toolCommOverride = Buffer.concat([
      writeVarintField(1, 1),             // SECTION_OVERRIDE_MODE_OVERRIDE
      writeStringField(2,
        sp.communicationWithTools),
    ]);
    convParts.push(writeMessageField(13, toolCommOverride));
  } else {
    // ── No client tools ──
    // Override system prompt sections to suppress Cascade's IDE-assistant
    // persona. Field numbers from CascadeConversationalPlannerConfig in
    // exa.cortex_pb.proto:
    //
    //   field 8  = string test_section_content  (PLAIN STRING, NOT a message!)
    //   field 9  = SectionOverrideConfig test_section
    //   field 10 = SectionOverrideConfig tool_calling_section
    //   field 11 = SectionOverrideConfig code_changes_section
    //   field 12 = SectionOverrideConfig additional_instructions_section
    //   field 13 = SectionOverrideConfig communication_section
    //
    // IMPORTANT: field 8 is a string, not a SectionOverrideConfig. Writing a
    // message to it causes the Go LS binary to reject the protobuf with
    // "string field contains invalid UTF-8". Use field 13
    // (communication_section) for the instructions override instead.

    // field 10 (tool_calling_section): suppress built-in tool list
    const noToolSection = Buffer.concat([
      writeVarintField(1, 1),             // SECTION_OVERRIDE_MODE_OVERRIDE
      writeStringField(2, 'No tools are available.'),
    ]);
    convParts.push(writeMessageField(10, noToolSection));

    // field 12 (additional_instructions): reinforce direct-answer mode.
    // Cascade's coding-agent training prior is strong — even with planner_mode
    // NO_TOOL and "no tools available" system text, it will still narrate
    // "Let me check /src/main.py" or "I opened config.yaml and saw..." purely
    // from distribution, and clients like Claude Code then try to Read those
    // paths in a loop (issue #24). Make the prohibition explicit at the
    // behaviour level, not just the capability level.
    const noToolAdditional = Buffer.concat([
      writeVarintField(1, 1),             // SECTION_OVERRIDE_MODE_OVERRIDE
      writeStringField(2,
        'CRITICAL OPERATING CONSTRAINT — READ BEFORE ANY RESPONSE:\n' +
        'You are being accessed as a plain chat API. You have NO tools, NO file access, NO shell, NO code execution, NO repository awareness, NO ability to list or read anything on the user\'s machine or any sandbox. You cannot "check", "look at", "open", "view", "inspect", "run", "glob", "grep", "list", or "edit" anything.\n' +
        '\n' +
        'OUTPUT RULES:\n' +
        '1. Never narrate tool-like actions ("Let me check X", "I\'ll look at Y", "Looking at the file...", "I see in main.py...", "Based on the codebase...").\n' +
        '2. Never reference file paths, directory structures, line numbers, or repository contents that were not explicitly pasted into the current conversation by the user.\n' +
        '3. If the user asks about their code or project but hasn\'t pasted the relevant file content, respond: "I don\'t see that file in our conversation — please paste it and I\'ll help." Do NOT invent file contents.\n' +
        '4. For general questions, answer directly from your training knowledge. No preambles.\n' +
        '5. Match the user\'s language (Chinese → Chinese, English → English; never switch mid-conversation).\n' +
        '\n' +
        'Violating these rules will produce broken output for the end user. Stay in chat-API mode at all times.'),
    ]);
    convParts.push(writeMessageField(12, noToolAdditional));

    // field 13 (communication_section): minimal — no identity manipulation.
    const spNoTools = getSystemPrompts();
    const communicationOverride = Buffer.concat([
      writeVarintField(1, 1),
      writeStringField(2, spNoTools.communicationNoTools),
    ]);
    convParts.push(writeMessageField(13, communicationOverride));
  }

  const conversationalConfig = Buffer.concat(convParts);
  const plannerParts = [
    writeMessageField(2, conversationalConfig),   // conversational = 2
  ];

  // Set BOTH the modern uid field (35) and the deprecated enum field (15)
  // when available. Seen in the wild (issue #8): free-tier / fresh accounts
  // report "user status is nil" during InitializeCascadePanelState and then
  // the server rejects the chat with "neither PlanModel nor RequestedModel
  // specified" if only field 35 is populated. Setting both covers whichever
  // field the upstream validator actually reads for that account state.
  // plan_model_uid (field 34) is also set as a safety fallback — some
  // backends require the plan model when user status has no tier info.
  if (modelUid) {
    plannerParts.push(writeStringField(35, modelUid));   // requested_model_uid
    plannerParts.push(writeStringField(34, modelUid));   // plan_model_uid (safety)
  }
  if (modelEnum && modelEnum > 0) {
    // requested_model_deprecated = ModelOrAlias { model = 1 (enum) }
    plannerParts.push(writeMessageField(15, writeVarintField(1, modelEnum)));
    // plan_model_deprecated = Model (enum directly at field 1)
    plannerParts.push(writeVarintField(1, modelEnum));
  }
  if (!modelUid && !modelEnum) {
    throw new Error('buildCascadeConfig: at least one of modelUid or modelEnum must be provided');
  }

  // max_output_tokens (field 6) — real IDE sends 16384/32768.
  // Missing this causes truncated long responses.
  plannerParts.push(writeVarintField(6, 32768));

  // code_changes_section (field 11) — suppress IDE-specific "apply changes" boilerplate
  if (!toolPreamble) {
    const emptySection = Buffer.concat([writeVarintField(1, 1), writeStringField(2, '')]);
    plannerParts.push(writeMessageField(11, emptySection));
  }

  // CascadePlannerConfig.tool_config = field 13 → CascadeToolConfig.
  // Only populated in native bridge mode. The allowlist (field 32) tells
  // the planner which built-in cascade tools to enable; the per-tool
  // sub-configs disable everything else by withholding their messages.
  if (nativeMode) {
    plannerParts.push(writeMessageField(13, buildNativeCascadeToolConfig(nativeAllowlist)));
  }

  const plannerConfig = Buffer.concat(plannerParts);

  const brainConfig = Buffer.concat([
    writeVarintField(1, 1),
    writeMessageField(6, writeMessageField(6, Buffer.alloc(0))),
  ]);

  // memory_config (field 5): {enabled=false} — prevent LS injecting user's
  // stored Cascade memories into API responses
  const memoryConfig = Buffer.concat([writeBoolField(1, false)]);

  return Buffer.concat([
    writeMessageField(1, plannerConfig),
    writeMessageField(5, memoryConfig),
    writeMessageField(7, brainConfig),
  ]);
}

/**
 * Build a minimal CascadeToolConfig for native bridge mode.
 *
 * field numbers (exa.cortex_pb.proto, message CascadeToolConfig):
 *   8  RunCommandToolConfig run_command
 *   10 ViewFileToolConfig   view_file
 *   19 ListDirToolConfig    list_dir
 *   33 GrepV2ToolConfig     grep_v2
 *   5  FindToolConfig       find
 *   32 repeated string tool_allowlist
 *
 * Each per-tool config is intentionally minimal — empty messages are
 * legal protobufs and tell the LS "enable this tool with defaults". The
 * tool_allowlist (field 32) is the authoritative gate: kinds NOT listed
 * there stay disabled even if their sub-config is present.
 */
function buildNativeCascadeToolConfig(allowlist = null) {
  const list = Array.isArray(allowlist) && allowlist.length
    ? allowlist
    : ['view_file', 'run_command', 'grep_search_v2', 'find', 'list_dir'];
  const parts = [];
  // Empty messages = "use defaults" for each enabled tool. Setting the
  // submessage at all is what tells the LS the tool is on.
  if (list.includes('run_command')) {
    parts.push(writeMessageField(8, Buffer.alloc(0)));
  }
  if (list.includes('view_file')) {
    parts.push(writeMessageField(10, Buffer.alloc(0)));
  }
  if (list.includes('list_dir') || list.includes('list_directory')) {
    parts.push(writeMessageField(19, Buffer.alloc(0)));
  }
  if (list.includes('grep_search_v2') || list.includes('grep_search')) {
    parts.push(writeMessageField(33, Buffer.alloc(0)));
  }
  if (list.includes('find')) {
    parts.push(writeMessageField(5, Buffer.alloc(0)));
  }
  // tool_allowlist (field 32, repeated string)
  for (const name of list) {
    parts.push(writeStringField(32, name));
  }
  return Buffer.concat(parts);
}

/**
 * Build GetCascadeTrajectoryStepsRequest.
 * Field 1: cascade_id, Field 2: step_offset
 */
export function buildGetTrajectoryStepsRequest(cascadeId, stepOffset = 0) {
  const parts = [writeStringField(1, cascadeId)];
  if (stepOffset > 0) parts.push(writeVarintField(2, stepOffset));
  return Buffer.concat(parts);
}

/**
 * Build GetCascadeTrajectoryRequest.
 * Field 1: cascade_id
 */
export function buildGetTrajectoryRequest(cascadeId) {
  return writeStringField(1, cascadeId);
}

/**
 * Build GetCascadeTrajectoryGeneratorMetadataRequest.
 *
 * Field 1: cascade_id
 * Field 2: generator_metadata_offset (uint32)
 *
 * The response carries real token counts from the generator models
 * (CortexStepGeneratorMetadata.chat_model.usage → ModelUsageStats).
 * CortexStepMetadata.model_usage on the trajectory steps themselves is
 * usually empty — the LS only fills it on this separate RPC.
 */
export function buildGetGeneratorMetadataRequest(cascadeId, offset = 0) {
  const parts = [writeStringField(1, cascadeId)];
  if (offset > 0) parts.push(writeVarintField(2, offset));
  return Buffer.concat(parts);
}

/**
 * Parse GetCascadeTrajectoryGeneratorMetadataResponse → aggregated usage.
 *
 * Response {
 *   repeated CortexStepGeneratorMetadata generator_metadata = 1;
 * }
 * CortexStepGeneratorMetadata {
 *   ChatModelMetadata chat_model = 1;
 *   ...
 * }
 * ChatModelMetadata {
 *   ...
 *   ModelUsageStats usage = 4;
 *   ...
 * }
 * ModelUsageStats {
 *   uint64 input_tokens = 2;
 *   uint64 output_tokens = 3;
 *   uint64 cache_write_tokens = 4;
 *   uint64 cache_read_tokens = 5;
 * }
 *
 * Returns null if nothing reported; otherwise an aggregated
 * {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, entryCount}
 * summed across every generator invocation (multi-model trajectories sum).
 *
 * `entryCount` is the number of generator-metadata records returned by this
 * response. On resumed cascades we use it as the next offset so prior-turn
 * usage is not counted again.
 */
export function parseGeneratorMetadata(buf) {
  const fields = parseFields(buf);
  const metaEntries = getAllFields(fields, 1).filter(f => f.wireType === 2);
  if (metaEntries.length === 0) return null;

  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  let found = false;

  for (const entry of metaEntries) {
    const gm = parseFields(entry.value);
    const chatModelField = getField(gm, 1, 2); // chat_model
    if (!chatModelField) continue;
    const cm = parseFields(chatModelField.value);
    const usageField = getField(cm, 4, 2); // usage
    if (!usageField) continue;
    const us = parseFields(usageField.value);
    const readUint = (fn) => {
      const f = getField(us, fn, 0);
      return f ? Number(f.value) : 0;
    };
    const inT = readUint(2);
    const outT = readUint(3);
    const cacheW = readUint(4);
    const cacheR = readUint(5);
    if (inT || outT || cacheW || cacheR) {
      inputTokens += inT;
      outputTokens += outT;
      cacheWriteTokens += cacheW;
      cacheReadTokens += cacheR;
      found = true;
    }
  }
  if (!found) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    entryCount: metaEntries.length,
  };
}

// ─── Cascade response parsers ──────────────────────────────

/** Parse StartCascadeResponse → cascade_id (field 1). */
export function parseStartCascadeResponse(buf) {
  const fields = parseFields(buf);
  const f1 = getField(fields, 1, 2);
  return f1 ? f1.value.toString('utf8') : '';
}

/** Parse GetCascadeTrajectoryResponse → status (field 2). */
export function parseTrajectoryStatus(buf) {
  const fields = parseFields(buf);
  const f2 = getField(fields, 2, 0);
  return f2 ? f2.value : 0;
}

/**
 * Parse GetCascadeTrajectoryStepsResponse → extract planner response text.
 *
 * Field 1: repeated CortexTrajectoryStep
 *   Step.field 1: type (enum, 15=PLANNER_RESPONSE)
 *   Step.field 4: status (enum, 3=DONE, 8=GENERATING)
 *   Step.field 20: planner_response { field 1: response, field 3: thinking }
 */
export function parseTrajectorySteps(buf) {
  const fields = parseFields(buf);
  const steps = getAllFields(fields, 1).filter(f => f.wireType === 2);
  const results = [];

  for (const step of steps) {
    const sf = parseFields(step.value);
    const typeField = getField(sf, 1, 0);
    const statusField = getField(sf, 4, 0);
    // CortexTrajectoryStep.planner_response = field 20
    // CortexStepPlannerResponse.response = 1, thinking = 3, modified_response = 8
    const plannerField = getField(sf, 20, 2);

    const entry = {
      type: typeField ? typeField.value : 0,
      status: statusField ? statusField.value : 0,
      text: '',
      thinking: '',
      errorText: '',
      toolCalls: [], // [{id, name, argumentsJson, result?}]
      usage: null,  // {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}
    };

    // CortexTrajectoryStep.metadata (field 5) → CortexStepMetadata.
    // CortexStepMetadata.model_usage (field 9) → ModelUsageStats.
    // ModelUsageStats:
    //   input_tokens       = 2 (uint64)
    //   output_tokens      = 3 (uint64)
    //   cache_write_tokens = 4 (uint64)
    //   cache_read_tokens  = 5 (uint64)
    // These are server-reported token counts for this step's generator model
    // and map cleanly onto OpenAI `usage.prompt_tokens` / `completion_tokens`
    // / `prompt_tokens_details.cached_tokens` when aggregated across steps.
    const stepMetaField = getField(sf, 5, 2);
    if (stepMetaField) {
      const meta = parseFields(stepMetaField.value);
      const usageField = getField(meta, 9, 2);
      if (usageField) {
        const us = parseFields(usageField.value);
        const readUint = (fn) => {
          const f = getField(us, fn, 0);
          return f ? Number(f.value) : 0;
        };
        const inputTokens = readUint(2);
        const outputTokens = readUint(3);
        const cacheWriteTokens = readUint(4);
        const cacheReadTokens = readUint(5);
        if (inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens) {
          entry.usage = { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens };
        }
      }
    }

    // Tool-call / tool-result sub-messages on CortexTrajectoryStep.
    // Sources: exa.cortex_pb.proto (AlexStrNik/windsurf-api).
    //   45 custom_tool         → CortexStepCustomTool{1=recipe_id,2=args,3=output,4=name}
    //   47 mcp_tool            → CortexStepMcpTool{1=server,2=ChatToolCall,3=result}
    //   49 tool_call_proposal  → {1=ChatToolCall}
    //   50 tool_call_choice    → {1=repeated ChatToolCall, 2=choice, 3=reason}
    // ChatToolCall (codeium_common_pb): 1=id, 2=name, 3=arguments_json
    const parseChatToolCall = (buf) => {
      const f = parseFields(buf);
      const id = getField(f, 1, 2);
      const name = getField(f, 2, 2);
      const args = getField(f, 3, 2);
      return {
        id: id ? id.value.toString('utf8') : '',
        name: name ? name.value.toString('utf8') : '',
        argumentsJson: args ? args.value.toString('utf8') : '',
      };
    };
    const customField = getField(sf, 45, 2);
    if (customField) {
      const cf = parseFields(customField.value);
      const recipeId = getField(cf, 1, 2);
      const argsF = getField(cf, 2, 2);
      const outF = getField(cf, 3, 2);
      const nameF = getField(cf, 4, 2);
      entry.toolCalls.push({
        id: recipeId ? recipeId.value.toString('utf8') : '',
        name: nameF ? nameF.value.toString('utf8') : (recipeId ? recipeId.value.toString('utf8') : 'custom_tool'),
        argumentsJson: argsF ? argsF.value.toString('utf8') : '',
        result: outF ? outF.value.toString('utf8') : '',
      });
    }
    const mcpField = getField(sf, 47, 2);
    if (mcpField) {
      const mf = parseFields(mcpField.value);
      const serverF = getField(mf, 1, 2);
      const callF = getField(mf, 2, 2);
      const resultF = getField(mf, 3, 2);
      if (callF) {
        const tc = parseChatToolCall(callF.value);
        tc.serverName = serverF ? serverF.value.toString('utf8') : '';
        tc.result = resultF ? resultF.value.toString('utf8') : '';
        entry.toolCalls.push(tc);
      }
    }
    const proposalField = getField(sf, 49, 2);
    if (proposalField) {
      const pf = parseFields(proposalField.value);
      const callF = getField(pf, 1, 2);
      if (callF) entry.toolCalls.push(parseChatToolCall(callF.value));
    }
    const choiceField = getField(sf, 50, 2);
    if (choiceField) {
      const cf = parseFields(choiceField.value);
      const chosenIdx = getField(cf, 2, 0);
      const calls = getAllFields(cf, 1).filter(x => x.wireType === 2).map(x => parseChatToolCall(x.value));
      if (calls.length) {
        const idx = chosenIdx ? Number(chosenIdx.value) : 0;
        entry.toolCalls.push(calls[idx] || calls[0]);
      }
    }

    // ── v2.0.65 native bridge: cascade-native IDE step kinds ──────────
    //
    // The planner emits these directly (no ChatToolCall wrapping) when
    // running in DEFAULT planner_mode. Each oneof field number on
    // CortexTrajectoryStep matches the per-kind body schema in
    // exa_cortex_pb_cortex.proto:
    //   13  CortexStepGrepSearch         (legacy, replaced by 105)
    //   14  CortexStepViewFile           {absolute_path_uri=1, content=4, ...}
    //   15  CortexStepListDirectory      {directory_path_uri=1, children=2*}
    //   23  CortexStepWriteToFile        {target_file_uri=1, code_content=2*}
    //   28  CortexStepRunCommand         {command_line=23, combined_output=21, ...}
    //   34  CortexStepFind               {pattern=1, search_directory=10, ...}
    //   105 CortexStepGrepSearchV2       {pattern=2, path=3, raw_output=15, ...}
    //
    // We surface these as toolCalls entries shaped like the wrapped
    // ChatToolCall variants — name = cascade kind ("view_file" /
    // "run_command" / ...), argumentsJson = JSON.stringify(decoded body),
    // result = the observation field for that kind. The OpenAI handler
    // (chat.js / messages.js / responses.js) translates these names back
    // into the caller's declared OpenAI tool name via TOOL_MAP reverse
    // lookup (see src/cascade-native-bridge.js).
    const NATIVE_STEP_FIELDS = [
      [14,  'view_file'],
      [15,  'list_directory'],
      [23,  'write_to_file'],
      [28,  'run_command'],
      [13,  'grep_search'],
      [34,  'find'],
      [105, 'grep_search_v2'],
    ];
    for (const [fieldNum, kind] of NATIVE_STEP_FIELDS) {
      const oneof = getField(sf, fieldNum, 2);
      if (!oneof) continue;
      const body = parseFields(oneof.value);
      let argumentsJson = '';
      let result = '';
      try {
        if (kind === 'view_file') {
          const args = {
            absolute_path_uri: getField(body, 1, 2)?.value?.toString('utf8') || '',
            offset: Number(getField(body, 11, 0)?.value || 0),
            limit: Number(getField(body, 12, 0)?.value || 0),
            start_line: Number(getField(body, 2, 0)?.value || 0),
            end_line: Number(getField(body, 3, 0)?.value || 0),
          };
          argumentsJson = JSON.stringify(args);
          result = getField(body, 4, 2)?.value?.toString('utf8') || '';
        } else if (kind === 'run_command') {
          const args = {
            command_line: getField(body, 23, 2)?.value?.toString('utf8')
                       || getField(body, 1, 2)?.value?.toString('utf8') || '',
            cwd: getField(body, 2, 2)?.value?.toString('utf8') || '',
          };
          argumentsJson = JSON.stringify(args);
          // Combined output preferred — newer LS versions only fill it.
          const combined = getField(body, 21, 2);
          if (combined) {
            const c = parseFields(combined.value);
            result = getField(c, 1, 2)?.value?.toString('utf8') || '';
          }
          if (!result) {
            // Legacy stdout / stderr top-level fields (deprecated).
            const stdout = getField(body, 4, 2)?.value?.toString('utf8') || '';
            const stderr = getField(body, 5, 2)?.value?.toString('utf8') || '';
            result = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
          }
        } else if (kind === 'grep_search_v2') {
          const args = {
            pattern: getField(body, 2, 2)?.value?.toString('utf8') || '',
            path: getField(body, 3, 2)?.value?.toString('utf8') || '',
            glob: getField(body, 4, 2)?.value?.toString('utf8') || '',
            output_mode: getField(body, 5, 2)?.value?.toString('utf8') || '',
            head_limit: Number(getField(body, 12, 0)?.value || 0),
          };
          argumentsJson = JSON.stringify(args);
          result = getField(body, 15, 2)?.value?.toString('utf8') || '';
        } else if (kind === 'grep_search') {
          const args = {
            query: getField(body, 1, 2)?.value?.toString('utf8') || '',
            search_path_uri: getField(body, 11, 2)?.value?.toString('utf8') || '',
          };
          argumentsJson = JSON.stringify(args);
          result = getField(body, 3, 2)?.value?.toString('utf8') || '';
        } else if (kind === 'find') {
          const args = {
            pattern: getField(body, 1, 2)?.value?.toString('utf8') || '',
            search_directory: getField(body, 10, 2)?.value?.toString('utf8') || '',
          };
          argumentsJson = JSON.stringify(args);
          result = getField(body, 11, 2)?.value?.toString('utf8') || '';
        } else if (kind === 'list_directory') {
          const children = getAllFields(body, 2)
            .filter(x => x.wireType === 2)
            .map(x => x.value.toString('utf8'));
          const args = {
            directory_path_uri: getField(body, 1, 2)?.value?.toString('utf8') || '',
          };
          argumentsJson = JSON.stringify(args);
          result = children.join('\n');
        } else if (kind === 'write_to_file') {
          const lines = getAllFields(body, 2)
            .filter(x => x.wireType === 2)
            .map(x => x.value.toString('utf8'));
          const args = {
            target_file_uri: getField(body, 1, 2)?.value?.toString('utf8') || '',
            code_content: lines,
          };
          argumentsJson = JSON.stringify(args);
        }
      } catch {
        argumentsJson = argumentsJson || '{}';
      }
      // Synthetic id keyed off step type + step index — the caller dedupes
      // on (id || name+args) so a stable shape avoids replays. The "native:"
      // prefix lets downstream layers tell these apart from ChatToolCall
      // wrappers without inspecting cascade_kind directly.
      entry.toolCalls.push({
        id: `native:${kind}:${results.length}`,
        name: kind,
        argumentsJson,
        result,
        cascade_native: true,
      });
    }

    if (plannerField) {
      const pf = parseFields(plannerField.value);
      const textField = getField(pf, 1, 2);
      const modifiedField = getField(pf, 8, 2);
      const thinkField = getField(pf, 3, 2);
      const responseText = textField ? textField.value.toString('utf8') : '';
      const modifiedText = modifiedField ? modifiedField.value.toString('utf8') : '';
      // modified_response is the LS post-pass edited final text (markdown
      // fixups, citations, tool-result folding). On long opus-4 replies the
      // LS writes a short `response` first, then overwrites with a much
      // longer `modified_response` at turn end. Prefer it whenever present
      // so we don't truncate to the early draft.
      entry.text = modifiedText || responseText;
      entry.responseText = responseText;
      entry.modifiedText = modifiedText;
      if (thinkField) entry.thinking = thinkField.value.toString('utf8');
    }

    // Walk CortexErrorDetails. user_error_message, short_error and full_error
    // usually contain the same text at increasing verbosity — pick one.
    const readErrorDetails = (buf) => {
      const ed = parseFields(buf);
      for (const fnum of [1, 2, 3]) {
        const f = getField(ed, fnum, 2);
        if (f) {
          const s = f.value.toString('utf8').trim();
          if (s) return s.split('\n')[0].slice(0, 300);
        }
      }
      return '';
    };

    // Error info lives at either CortexTrajectoryStep.error_message (field 24
    // for ERROR_MESSAGE steps) or CortexTrajectoryStep.error (field 31 for any
    // step). They both wrap CortexErrorDetails. Prefer the step-specific one.
    const errMsgField = getField(sf, 24, 2);
    if (errMsgField) {
      const inner = getField(parseFields(errMsgField.value), 3, 2);
      if (inner) entry.errorText = readErrorDetails(inner.value);
    }
    if (!entry.errorText) {
      const errField = getField(sf, 31, 2);
      if (errField) entry.errorText = readErrorDetails(errField.value);
    }


    results.push(entry);
  }

  return results;
}

// ─── GetUserStatus (authoritative tier + model allowlist) ──
//
// LanguageServerService/GetUserStatus → GetUserStatusResponse {
//   UserStatus user_status = 1;
//   PlanInfo   plan_info   = 2;
// }
// GetUserStatusRequest { Metadata metadata = 1; }
//
// Beats our probe-based inferTier — one RPC returns exact tier, trial
// end time, per-model allowlist with credit multipliers, credit usage.
// Verified via extracted FileDescriptorProto on 2026-04-21 (scripts/ls-protos).

export function buildGetUserStatusRequest(apiKey) {
  return writeMessageField(1, buildMetadata(apiKey));
}

export function extractUserStatusBytes(getUserStatusResponseBuf) {
  if (!getUserStatusResponseBuf || getUserStatusResponseBuf.length === 0) return null;
  const top = parseFields(getUserStatusResponseBuf);
  return getField(top, 1, 2)?.value || null;
}

// exa.codeium_common_pb.TeamsTier → free | pro
// Values as defined in the binary (enum TeamsTier). Paid/trial tiers all
// map to 'pro' so the caller can unlock premium models uniformly.
// UNSPECIFIED(0) and WAITLIST_PRO(6) and DEVIN_FREE(19) are the only frees.
export function mapTeamsTier(t) {
  if (t === 0 || t === 6 || t === 19) return 'free';
  if (t > 0) return 'pro';
  return 'unknown';
}

// Human-readable label for dashboard display.
export function teamsTierLabel(t) {
  return ({
    0: 'Unspecified', 1: 'Teams', 2: 'Pro', 3: 'Enterprise (SaaS)',
    4: 'Hybrid', 5: 'Enterprise (Self-Hosted)', 6: 'Waitlist Pro',
    7: 'Teams Ultimate', 8: 'Pro Ultimate', 9: 'Trial',
    10: 'Enterprise (Self-Serve)', 11: 'Enterprise (SaaS Pooled)',
    12: 'Devin Enterprise', 14: 'Devin Teams', 15: 'Devin Teams V2',
    16: 'Devin Pro', 17: 'Devin Max', 18: 'Max',
    19: 'Devin Free', 20: 'Devin Trial',
  })[t] || `Tier ${t}`;
}

/**
 * Parse GetUserStatusResponse into a flat object.
 *
 * UserStatus field numbers (exa.codeium_common_pb.UserStatus):
 *   1  pro (bool)
 *   3  name (string)
 *   5  team_id (string)
 *   7  email (string)
 *   10 teams_tier (TeamsTier enum)
 *   13 plan_status (PlanStatus message)
 *   28 user_used_prompt_credits (int64)
 *   29 user_used_flow_credits (int64)
 *   33 cascade_model_config_data (CascadeModelConfigData)
 *   34 windsurf_pro_trial_end_time (Timestamp)
 *   35 max_num_premium_chat_messages (int64)
 *
 * PlanInfo field numbers (exa.codeium_common_pb.PlanInfo):
 *   1  teams_tier
 *   2  plan_name (string)
 *   12 monthly_prompt_credits (int32)
 *   13 monthly_flow_credits (int32)
 *   16 is_enterprise (bool)
 *   17 is_teams (bool)
 *   21 cascade_allowed_models_config (repeated AllowedModelConfig)
 *   32 has_paid_features (bool)
 *
 * AllowedModelConfig { ModelOrAlias model_or_alias = 1; float credit_multiplier = 2; }
 * ModelOrAlias       { Model model = 1; ModelAlias alias = 2; }  (oneof in practice)
 */
export function parseGetUserStatusResponse(buf) {
  const out = {
    pro: false,
    teamsTier: 0,
    tierName: '',
    email: '',
    displayName: '',
    teamId: '',
    userUsedPromptCredits: 0,
    userUsedFlowCredits: 0,
    trialEndMs: 0,
    maxPremiumChatMessages: 0,
    planName: '',
    monthlyPromptCredits: 0,
    monthlyFlowCredits: 0,
    hasPaidFeatures: false,
    isTeams: false,
    isEnterprise: false,
    allowedModels: [], // [{ modelEnum, alias, multiplier }]
  };

  if (!buf || buf.length === 0) {
    out.tierName = mapTeamsTier(out.teamsTier);
    return out;
  }
  const top = parseFields(buf);
  const usBuf = getField(top, 1, 2)?.value;
  const piBuf = getField(top, 2, 2)?.value;

  if (usBuf && usBuf.length) {
    const us = parseFields(usBuf);
    out.pro = (getField(us, 1, 0)?.value ?? 0) === 1;
    out.displayName = getField(us, 3, 2)?.value?.toString('utf8') || '';
    out.teamId = getField(us, 5, 2)?.value?.toString('utf8') || '';
    out.email = getField(us, 7, 2)?.value?.toString('utf8') || '';
    out.teamsTier = getField(us, 10, 0)?.value ?? 0;
    out.userUsedPromptCredits = Number(getField(us, 28, 0)?.value ?? 0);
    out.userUsedFlowCredits = Number(getField(us, 29, 0)?.value ?? 0);
    out.maxPremiumChatMessages = Number(getField(us, 35, 0)?.value ?? 0);
    const tsBuf = getField(us, 34, 2)?.value;
    if (tsBuf && tsBuf.length) {
      const tsFields = parseFields(tsBuf);
      const secs = Number(getField(tsFields, 1, 0)?.value ?? 0);
      out.trialEndMs = secs * 1000;
    }
  }

  if (piBuf && piBuf.length) {
    const pi = parseFields(piBuf);
    if (!out.teamsTier) out.teamsTier = getField(pi, 1, 0)?.value ?? 0;
    out.planName = getField(pi, 2, 2)?.value?.toString('utf8') || '';
    out.monthlyPromptCredits = Number(getField(pi, 12, 0)?.value ?? 0);
    out.monthlyFlowCredits = Number(getField(pi, 13, 0)?.value ?? 0);
    out.isEnterprise = (getField(pi, 16, 0)?.value ?? 0) === 1;
    out.isTeams = (getField(pi, 17, 0)?.value ?? 0) === 1;
    out.hasPaidFeatures = (getField(pi, 32, 0)?.value ?? 0) === 1;

    // cascade_allowed_models_config — repeated AllowedModelConfig (field 21)
    for (const entry of getAllFields(pi, 21)) {
      if (entry.wireType !== 2) continue;
      const ac = parseFields(entry.value);
      const moaBuf = getField(ac, 1, 2)?.value;
      // credit_multiplier is float → wire type 5 (fixed32)
      const cmField = getField(ac, 2, 5);
      let multiplier = 1.0;
      if (cmField && cmField.value.length === 4) {
        multiplier = cmField.value.readFloatLE(0);
      }
      let modelEnum = 0;
      let alias = 0;
      if (moaBuf && moaBuf.length) {
        const moa = parseFields(moaBuf);
        modelEnum = getField(moa, 1, 0)?.value ?? 0;
        alias = getField(moa, 2, 0)?.value ?? 0;
      }
      out.allowedModels.push({ modelEnum, alias, multiplier });
    }
  }

  out.tierName = mapTeamsTier(out.teamsTier);
  return out;
}

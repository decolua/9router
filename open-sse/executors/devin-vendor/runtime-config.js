// Minimal runtime-config shim — vendor's windsurf.js consumes only
// getSystemPrompts() (3 default prompts). Hardcode them so the rest of
// the Windsurf machinery doesn't need 9router's dashboard/persistence layer.
//
// If you ever want to make these tunable, wire this through to 9router's
// settings store; for now defaults are enough.
export function getSystemPrompts() {
  return {
    toolReinforcement: 'The functions listed above are available and callable. When the user\'s request can be answered by calling a function, emit a <tool_call> block as described. Use this exact format: <tool_call>{"name":"...","arguments":{...}}</tool_call>',
    communicationWithTools: 'You are accessed via API. When asked about your identity, describe your actual underlying model name and provider accurately. STRICTLY respond in the exact same language the user used in their latest message (Chinese → Chinese, English → English, Japanese → Japanese; never switch mid-conversation). Use the functions above when relevant.',
    communicationNoTools: 'You are accessed via API. When asked about your identity, describe your actual underlying model name and provider accurately. Answer directly. STRICTLY respond in the exact same language the user used in their latest message (Chinese → Chinese, English → English, Japanese → Japanese; never switch mid-conversation).',
  };
}

export function isExperimentalEnabled(_key) { return false; }

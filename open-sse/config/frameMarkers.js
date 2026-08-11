// The vocabulary of the conversation frame.
//
// The router owns the framing of a conversation; the client owns its content.
// Control markers below belong to the client's harness — they are how the
// harness speaks to itself. A model emitting one is forging a control signal,
// which is a protocol violation and is decidable without judging whether the
// response is any good. See CONTEXT.md ("Owning the conversation") and
// docs/adr/0002.
//
// One list, one place. These strings were previously duplicated between
// utils/echoScrub.js and translator/response/openai-to-claude.js, which is
// exactly the hardcoding the repo's own conventions forbid: a marker added to
// one copy silently failed to apply on the other path.

// Harness XML wrapper blocks. A model never legitimately emits these as its own
// output — when one appears, the model is replaying scaffolding it was shown.
export const FRAME_TAGS = [
  "instructions",
  "system-reminder",
  "task-notification",
  "command-message",
  "command-name",
];

// Literal control strings the harness writes into a transcript to describe what
// happened to a turn. A model producing one is claiming the harness's voice.
// Prefixes, not whole lines: the real markers carry a trailing variant
// ("... for tool use]") that must match the same entry.
export const FRAME_CONTROL_MARKERS = [
  "[Request interrupted by user",
  "[Request cancelled by user",
];

// True when text carries a marker that belongs to the frame rather than the
// content. Detection only — deciding what to do about it is the caller's job,
// and the answer is never "edit the text to taste".
export function hasFrameMarker(text) {
  if (typeof text !== "string" || !text) return false;
  for (const tag of FRAME_TAGS) {
    if (text.includes("<" + tag + ">")) return true;
  }
  for (const marker of FRAME_CONTROL_MARKERS) {
    if (text.includes(marker)) return true;
  }
  return false;
}

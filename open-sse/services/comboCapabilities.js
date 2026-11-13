/**
 * Capabilities a combo pool can honour.
 *
 * A request routed to a combo may land on any member — `reorderModelsByCapability`
 * sorts by fit but never drops a model, so fallback can reach any of them. The
 * pool can therefore only promise a feature every member has: declaring
 * `tools: true` because one member supports them is a promise the fallback
 * breaks, silently, on the turn it matters.
 *
 * Only the flags a downstream client reads to decide what to send are reported.
 * The rest of the capability record (thinking wire format, budget ranges, token
 * limits) describes how to talk to one specific model and does not survive being
 * merged across a pool, so it is deliberately left off.
 *
 * `capsFor` receives one member reference ("alias/model-id") and returns that
 * model's capabilities; passing it in keeps this pure and lets the caller own
 * the alias-to-provider mapping.
 */

// Every member has a definite answer for these: getCapabilitiesForModel merges
// with DEFAULT_CAPABILITIES, so an unknown model reports the default rather than
// nothing. That is what makes the conservative AND safe here — there is no
// "unknown" to mistake for false.
export const COMBO_REPORTED_CAPABILITIES = [
  "tools",
  "vision",
  "reasoning",
  "search",
  "pdf",
  "audioInput",
  "videoInput",
  "imageOutput",
  "audioOutput",
];

export function comboCapabilities(members, capsFor) {
  if (!Array.isArray(members)) return null;

  const usable = members.filter((ref) => typeof ref === "string" && ref.trim() !== "");
  if (usable.length === 0) return null;

  const result = {};
  for (const field of COMBO_REPORTED_CAPABILITIES) {
    let supported = true;
    for (const ref of usable) {
      const caps = capsFor(ref);
      if (caps?.[field] !== true) {
        supported = false;
        break;
      }
    }
    result[field] = supported;
  }
  return result;
}

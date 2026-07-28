// Discipline nudge: after a model emits malformed tool JSON or echoes the
// harness's XML wrapper blocks into visible output, prepend one corrective
// line to that model's NEXT request. consumeNudge() clears the flag, so a
// strike burst produces a single nudge rather than a permanent tax on every
// later request to the same model.
//
// The key MUST match how stream.js builds state.servingModel
// (`${provider}/${model}`), or strikes and nudges land in different buckets
// and the nudge silently never fires.

import { injectSystemPrompt } from "./systemInject.js";
import { consumeNudge } from "../utils/discipline.js";

export const DISCIPLINE_NUDGE =
  "Output discipline: your previous response was malformed. Either a tool call's " +
  "arguments were not valid JSON (they arrived duplicated or truncated), or harness " +
  "XML blocks such as <instructions> and <system-reminder> were echoed into visible " +
  "output. Emit each tool call's arguments as exactly one valid JSON object, and " +
  "never reproduce harness XML in your reply.";

export function disciplineKey(provider, model) {
  return provider && model ? `${provider}/${model}` : model;
}

export function injectDisciplineNudge(body, format, provider, model) {
  const key = disciplineKey(provider, model);
  if (!key) return false;
  if (!consumeNudge(key)) return false;
  injectSystemPrompt(body, format, DISCIPLINE_NUDGE);
  return true;
}

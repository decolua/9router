// Appends enabled agent skills to the system prompt of the outgoing request,
// the same way caveman/ponytail do — one shared injector handles every wire
// format, so a skill reaches Claude, Gemini, Kiro and OpenAI-shaped providers
// alike.
//
// Unlike the token-saver injectors this is not gated on tokenSaverEnabled: a
// skill changes how the model answers, which is not a compression setting.

import { injectSystemPrompt } from "../rtk/systemInject.js";

const SEP = "\n\n---\n\n";

/**
 * @param {Array<{name?:string, body?:string}>} skills enabled skills, in order
 * @returns {string} the combined prompt, or "" when there is nothing to add
 */
export function buildSkillsPrompt(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "";
  const parts = [];
  for (const skill of skills) {
    const body = typeof skill?.body === "string" ? skill.body.trim() : "";
    if (body) parts.push(body);
  }
  return parts.join(SEP);
}

/**
 * @returns {string[]} names of the skills actually injected, for the log line
 */
export function injectAgentSkills(body, format, skills) {
  const prompt = buildSkillsPrompt(skills);
  if (!prompt) return [];
  injectSystemPrompt(body, format, prompt);
  return skills.filter((s) => typeof s?.body === "string" && s.body.trim()).map((s) => s?.name || "skill");
}

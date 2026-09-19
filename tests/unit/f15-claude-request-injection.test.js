// F15 / T1.2 M5 — the "You are Claude Code" persona was injected on EVERY
// openai→claude translation, with no condition at all: any generic chat app
// routed to an Anthropic API key (or an Anthropic-compatible gateway) came out
// claiming to be Anthropic's CLI, and paid a 1h cache breakpoint per call. It
// also sat at system[0], ahead of the client's own system prompt.
//
// The persona is an OAuth-fingerprint artefact (same family as the billing
// header + fake user id in utils/claudeCloaking.js, gated on `sk-ant-oat`, and
// on the tool-name prefix that commit 07d4cdfa "Fix : Claude OAuth" emptied
// "to match real Claude Code behavior"). So it belongs ONLY on the OAuth path,
// and never where it can shadow a client-supplied system prompt.
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";

const PERSONA = "You are Claude Code, Anthropic's official CLI for Claude.";

// The two credential shapes the engine actually sees: a plain API key (generic
// Anthropic / Anthropic-compatible) and an OAuth token (claude-oauth account).
const API_KEY_CREDS = { apiKey: "sk-ant-api03-generic-key" };
const OAUTH_CREDS = { accessToken: "sk-ant-oat01-personal-account-token" };

function systemBlocks(out) {
  if (Array.isArray(out.system)) return out.system;
  if (typeof out.system === "string") return [{ type: "text", text: out.system }];
  return [];
}

function systemText(out) {
  return systemBlocks(out)
    .map((b) => (typeof b === "string" ? b : b?.text || ""))
    .join("\n");
}

const hasPersona = (out) => systemText(out).includes(PERSONA);

function userBody(text = "hi") {
  return { messages: [{ role: "user", content: text }] };
}

function bodyWithSystem(system) {
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: "hi" },
    ],
  };
}

describe("F15 M5 — Claude Code persona is scoped to claude-oauth only", () => {
  describe("openaiToClaudeRequest (translator leg)", () => {
    it("does NOT inject the persona for a generic API key", () => {
      const out = openaiToClaudeRequest("claude-sonnet-4-5", userBody(), false, API_KEY_CREDS);
      expect(hasPersona(out), `persona leaked: ${systemText(out)}`).toBe(false);
      // Nothing else to say → no system at all (no phantom 1h cache breakpoint).
      expect(out.system).toBeUndefined();
    });

    it("does NOT inject the persona when no credentials are available at all", () => {
      const out = openaiToClaudeRequest("claude-sonnet-4-5", userBody(), false);
      expect(hasPersona(out)).toBe(false);
      expect(out.system).toBeUndefined();
    });

    it("injects the persona ONLY for an OAuth token and only when the client sent no system", () => {
      const out = openaiToClaudeRequest("claude-sonnet-4-5", userBody(), false, OAUTH_CREDS);
      const blocks = systemBlocks(out);
      expect(blocks[0]?.text).toBe(PERSONA);
      expect(cloned(blocks[0])).not.toHaveProperty("cache_control");
    });

    it("never shadows a client-supplied system prompt (generic key)", () => {
      const out = openaiToClaudeRequest("claude-sonnet-4-5", bodyWithSystem("You are a pirate."), false, API_KEY_CREDS);
      expect(hasPersona(out)).toBe(false);
      expect(systemBlocks(out)[0].text).toBe("You are a pirate.");
    });

    it("never shadows a client-supplied system prompt even under OAuth", () => {
      const out = openaiToClaudeRequest("claude-sonnet-4-5", bodyWithSystem("You are a pirate."), false, OAUTH_CREDS);
      expect(hasPersona(out)).toBe(false);
      expect(systemBlocks(out)[0].text).toBe("You are a pirate.");
    });
  });

  describe("translateRequest (full pipeline, as chatCore calls it)", () => {
    const T = (body, credentials, provider = "claude") =>
      translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", body, true, credentials, provider);

    it("generic API key → no persona anywhere in the upstream body", () => {
      const out = T(userBody(), API_KEY_CREDS);
      expect(hasPersona(out), `persona leaked: ${systemText(out)}`).toBe(false);
    });

    it("Anthropic-compatible gateway → no persona anywhere in the upstream body", () => {
      const out = T(userBody(), API_KEY_CREDS, "anthropic-compatible-x");
      expect(hasPersona(out), `persona leaked: ${systemText(out)}`).toBe(false);
    });

    it("OAuth credentials keep the persona (fingerprint preserved)", () => {
      const out = T(userBody(), OAUTH_CREDS);
      expect(hasPersona(out)).toBe(true);
    });

    it("client system survives the pipeline on both credential kinds", () => {
      for (const credentials of [API_KEY_CREDS, OAUTH_CREDS]) {
        const out = T(bodyWithSystem("You are a pirate."), credentials);
        const text = systemText(out);
        expect(text).toContain("You are a pirate.");
        expect(hasPersona(out), `persona shadowed client system for ${credentials.accessToken || credentials.apiKey}`).toBe(false);
        // The client's own block must lead the prompt (cloaking may prepend the
        // billing header, which is not a persona and stays a separate block).
        const clientIdx = systemBlocks(out).findIndex((b) => (b?.text || "").includes("You are a pirate."));
        expect(clientIdx).toBeGreaterThanOrEqual(0);
        expect(
          systemBlocks(out)
            .slice(0, clientIdx)
            .every((b) => !(b?.text || "").includes(PERSONA))
        ).toBe(true);
      }
    });
  });
});

function cloned(block) {
  return JSON.parse(JSON.stringify(block));
}

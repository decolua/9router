import { describe, expect, it } from "vitest";
import {
  buildModelBlock,
  buildDelegationBlock,
  buildAuxRoleBlock,
  parseModelBlock,
  parseDelegationBlock,
  parseAuxRoles,
  upsertModelBlock,
  upsertDelegationBlock,
  upsertAuxRole,
  removeModelBlock,
  removeDelegationBlock,
  removeAuxRole,
  upsertEnvVar,
  removeEnvVar,
  has9RouterConfig,
  isCustomBlock,
} from "../../src/app/api/cli-tools/hermes-settings/hermesYaml.js";

const BASE = "http://127.0.0.1:20128/v1";

// Every top-level `model:` key in the document (mapping head OR scalar line).
const modelKeys = (yaml) => yaml.match(/^model:/gm) || [];

const FRESH_INSTALL = `model: ""\nagent:\n  reasoning_effort: medium\n`;
const EXISTING_MAPPING = `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n  base_url: ""\n`;

describe("hermes config.yaml helpers", () => {
  describe("upsertModelBlock", () => {
    it("replaces the fresh-install `model: \"\"` sentinel instead of duplicating the key", () => {
      const out = upsertModelBlock(FRESH_INSTALL, buildModelBlock("anthropic/claude-sonnet-4-6", BASE));
      expect(modelKeys(out)).toHaveLength(1);
      expect(out).toContain('default: "anthropic/claude-sonnet-4-6"');
      expect(out).not.toContain('model: ""');
      // everything else in the file survives
      expect(out).toContain("reasoning_effort: medium");
    });

    it("replaces an existing mapping block in place", () => {
      const out = upsertModelBlock(EXISTING_MAPPING, buildModelBlock("openai/gpt-5.5", BASE));
      expect(modelKeys(out)).toHaveLength(1);
      expect(out).toContain('default: "openai/gpt-5.5"');
      expect(out).not.toContain("openrouter");
    });

    it("prepends a block when the file has no model key", () => {
      const out = upsertModelBlock("agent:\n  timeout: 30\n", buildModelBlock("m", BASE));
      expect(modelKeys(out)).toHaveLength(1);
      expect(out.startsWith("model:")).toBe(true);
      expect(out).toContain("timeout: 30");
    });

    it("handles an empty config file", () => {
      expect(upsertModelBlock("", buildModelBlock("m", BASE))).toContain('default: "m"');
    });

    it("never touches model_aliases", () => {
      const yaml = "model_aliases:\n  fav:\n    model: x\n    provider: anthropic\n";
      const out = upsertModelBlock(yaml, buildModelBlock("m", BASE));
      expect(modelKeys(out)).toHaveLength(1);
      expect(out).toContain("model_aliases:");
    });
  });

  describe("removeModelBlock", () => {
    it("removes a mapping block", () => {
      expect(modelKeys(removeModelBlock(EXISTING_MAPPING))).toHaveLength(0);
    });

    it("removes the scalar sentinel line", () => {
      const out = removeModelBlock(FRESH_INSTALL);
      expect(modelKeys(out)).toHaveLength(0);
      expect(out).toContain("reasoning_effort: medium");
    });

    it("leaves a file without a model key untouched", () => {
      const yaml = "agent:\n  timeout: 30\n";
      expect(removeModelBlock(yaml)).toBe(yaml);
    });
  });

  describe("parseModelBlock", () => {
    it("reads provider/default/base_url from a mapping", () => {
      const parsed = parseModelBlock(upsertModelBlock(FRESH_INSTALL, buildModelBlock("m1", BASE)));
      expect(parsed).toMatchObject({ default: "m1", provider: "custom", base_url: BASE });
    });

    it("returns null for the sentinel (unconfigured)", () => {
      expect(parseModelBlock(FRESH_INSTALL)).toBeNull();
      expect(parseModelBlock("")).toBeNull();
    });
  });

  describe("delegation + auxiliary blocks", () => {
    it("upserts and parses the delegation block", () => {
      let yaml = upsertModelBlock(FRESH_INSTALL, buildModelBlock("m1", BASE));
      yaml = upsertDelegationBlock(yaml, buildDelegationBlock("m2", BASE));
      const parsed = parseDelegationBlock(yaml);
      expect(parsed).toMatchObject({ model: "m2", provider: "custom", base_url: BASE });
      // second upsert must not duplicate the block
      yaml = upsertDelegationBlock(yaml, buildDelegationBlock("m3", BASE));
      expect(yaml.match(/^delegation:/gm)).toHaveLength(1);
      expect(parseDelegationBlock(yaml).model).toBe("m3");
      expect(modelKeys(yaml)).toHaveLength(1);
    });

    it("upserts, parses and removes auxiliary roles", () => {
      let yaml = upsertModelBlock(FRESH_INSTALL, buildModelBlock("m1", BASE));
      yaml = upsertAuxRole(yaml, "vision", buildAuxRoleBlock("vision", "google/gemini-2.5-flash", BASE));
      yaml = upsertAuxRole(yaml, "compression", buildAuxRoleBlock("compression", "openai/gpt-4o-mini", BASE));
      expect(Object.keys(parseAuxRoles(yaml)).sort()).toEqual(["compression", "vision"]);

      yaml = upsertAuxRole(yaml, "vision", buildAuxRoleBlock("vision", "openai/gpt-4o", BASE));
      expect(parseAuxRoles(yaml).vision.model).toBe("openai/gpt-4o");
      expect(Object.keys(parseAuxRoles(yaml))).toHaveLength(2);

      yaml = removeAuxRole(yaml, "vision");
      expect(Object.keys(parseAuxRoles(yaml))).toEqual(["compression"]);
      yaml = removeAuxRole(yaml, "compression");
      expect(parseAuxRoles(yaml)).toEqual({});
      expect(yaml).not.toContain("auxiliary:");
      expect(modelKeys(yaml)).toHaveLength(1);
    });
  });

  describe(".env helpers", () => {
    it("upserts a key without disturbing the rest of the file", () => {
      expect(upsertEnvVar("", "OPENAI_API_KEY", "k1")).toBe("OPENAI_API_KEY=k1\n");
      const env = "TELEGRAM_BOT_TOKEN=tok\nOPENAI_API_KEY=old\nDISCORD_ALLOWED_USERS=1\n";
      const out = upsertEnvVar(env, "OPENAI_API_KEY", "new");
      expect(out).toContain("OPENAI_API_KEY=new");
      expect(out).toContain("TELEGRAM_BOT_TOKEN=tok");
      expect(out).toContain("DISCORD_ALLOWED_USERS=1");
      expect(out.match(/^OPENAI_API_KEY=/gm)).toHaveLength(1);
    });

    it("removes only the requested key", () => {
      const env = removeEnvVar("A=1\nOPENAI_API_KEY=k\nB=2\n", "OPENAI_API_KEY");
      expect(env).toBe("A=1\nB=2\n");
    });
  });

  describe("9router detection", () => {
    it("recognises a local 9router endpoint", () => {
      expect(has9RouterConfig({ provider: "custom", base_url: "http://127.0.0.1:20128/v1" })).toBe(true);
      expect(has9RouterConfig({ provider: "custom", base_url: "http://localhost:20128/v1" })).toBe(true);
    });

    it("rejects other providers or endpoints", () => {
      expect(has9RouterConfig({ provider: "openrouter", base_url: "http://127.0.0.1:1/v1" })).toBe(false);
      expect(has9RouterConfig({ provider: "custom", base_url: "https://abc.ngrok.app/v1" })).toBe(false);
      expect(has9RouterConfig(null)).toBe(false);
    });

    it("classifies custom-provider blocks (incl. tunnel endpoints)", () => {
      expect(isCustomBlock({ provider: "custom" })).toBe(true);
      expect(isCustomBlock({ provider: "openrouter" })).toBe(false);
      expect(isCustomBlock(null)).toBe(false);
    });
  });
});

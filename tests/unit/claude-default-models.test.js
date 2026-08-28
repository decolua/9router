import { describe, it, expect } from "vitest";
import {
  CLAUDE_ROLE_KEYS,
  emptyClaudeDefaults,
  sanitizeDefaultModels,
  buildClaudeEnvOverrides,
  sanitizeEnvOverrides,
  mergeClaudeEnv,
} from "@/shared/utils/claudeEnv";

describe("claudeEnv pure helpers", () => {
  it("maps the four roles + subagent to env keys", () => {
    const d = {
      sonnet: { model: "glm/glm-5.3", name: "glm/glm-5.3", oneM: true },
      opus: { model: "glm/glm-5.3", name: "glm/glm-5.3", oneM: true },
      fable: { model: "glm/glm-5.3", name: "glm/glm-5.3", oneM: true },
      haiku: { model: "glm/glm-5.3", name: "glm/glm-5.3", oneM: false },
      subagent: { model: "glm/glm-4.7", oneM: false },
    };
    expect(buildClaudeEnvOverrides(d)).toEqual({
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm/glm-5.3[1M]",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "glm/glm-5.3",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm/glm-5.3[1M]",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm/glm-5.3",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "glm/glm-5.3[1M]",
      ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: "glm/glm-5.3",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm/glm-5.3",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "glm/glm-5.3",
      CLAUDE_CODE_SUBAGENT_MODEL: "glm/glm-4.7",
    });
  });

  it("omits keys for empty roles and missing display names", () => {
    const d = emptyClaudeDefaults();
    d.sonnet.model = "glm/glm-5.3"; // no name
    expect(buildClaudeEnvOverrides(d)).toEqual({
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm/glm-5.3",
    });
  });

  it("sanitizeDefaultModels repairs garbage into the clean shape", () => {
    const clean = sanitizeDefaultModels({ sonnet: { model: 42, oneM: "yes" }, junk: true });
    expect(Object.keys(clean).sort()).toEqual(
      [...CLAUDE_ROLE_KEYS, "subagent"].sort(),
    );
    expect(clean.sonnet).toEqual({ model: "", name: "", oneM: false });
    expect(clean.junk).toBeUndefined();
  });

  it("sanitizeEnvOverrides keeps strings, stringifies scalars, drops the rest", () => {
    expect(sanitizeEnvOverrides({
      A: "x", B: 3, C: true, D: null, E: { deep: 1 }, F: [1], G: undefined,
    })).toEqual({ A: "x", B: "3", C: "true" });
    expect(sanitizeEnvOverrides(null)).toEqual({});
    expect(sanitizeEnvOverrides([1, 2])).toEqual({});
  });

  it("mergeClaudeEnv strictly key-overwrites env and never deletes", () => {
    const settings = {
      permissions: { allow: ["Bash"] },
      env: {
        ANTHROPIC_AUTH_TOKEN: "keep-me",
        ANTHROPIC_BASE_URL: "http://localhost:20128/v1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "old-value",
        DISABLE_TELEMETRY: "1",
      },
    };
    const next = mergeClaudeEnv(settings, {
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm/glm-5.3[1M]",
      ANTHROPIC_MODEL: "glm/glm-5.3",
    });
    // untouched keys survive
    expect(next.env.ANTHROPIC_AUTH_TOKEN).toBe("keep-me");
    expect(next.env.ANTHROPIC_BASE_URL).toBe("http://localhost:20128/v1");
    expect(next.env.DISABLE_TELEMETRY).toBe("1");
    expect(next.permissions).toEqual({ allow: ["Bash"] });
    // same-key overwritten
    expect(next.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm/glm-5.3[1M]");
    expect(next.env.ANTHROPIC_MODEL).toBe("glm/glm-5.3");
    // input not mutated
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("old-value");
  });

  it("mergeClaudeEnv creates env when settings.json has none", () => {
    const next = mergeClaudeEnv({ hello: "world" }, { ANTHROPIC_MODEL: "m" });
    expect(next).toEqual({ hello: "world", env: { ANTHROPIC_MODEL: "m" } });
  });
});

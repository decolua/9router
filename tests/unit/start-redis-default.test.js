import { describe, expect, it } from "vitest";

import { resolveRedisUrl } from "../../scripts/start.js";

describe("start redis URL resolution", () => {
  it("defaults to localhost Redis when no CLI, runtime config, or env value is set", () => {
    expect(
      resolveRedisUrl({
        cliRedisUrl: "",
        configRedisUrl: "",
        envRedisUrl: "",
      })
    ).toBe("redis://127.0.0.1:6379");
  });

  it("preserves explicit CLI, runtime config, and env precedence over the default", () => {
    expect(
      resolveRedisUrl({
        cliRedisUrl: "redis://cli.example:6379",
        configRedisUrl: "redis://config.example:6379",
        envRedisUrl: "redis://env.example:6379",
      })
    ).toBe("redis://cli.example:6379");

    expect(
      resolveRedisUrl({
        cliRedisUrl: "",
        configRedisUrl: "redis://config.example:6379",
        envRedisUrl: "redis://env.example:6379",
      })
    ).toBe("redis://config.example:6379");

    expect(
      resolveRedisUrl({
        cliRedisUrl: "",
        configRedisUrl: "",
        envRedisUrl: "redis://env.example:6379",
      })
    ).toBe("redis://env.example:6379");
  });
});

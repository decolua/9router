import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildServerEnv } = require("../../cli/src/cli/serverEnv.js");

describe("buildServerEnv", () => {
  const baseEnv = { PATH: "/usr/bin" };

  it("tells the server to skip its own update notice when --skip-update was passed", () => {
    const env = buildServerEnv({ baseEnv, port: 20128, host: "0.0.0.0", skipUpdate: true });

    expect(env.PORT).toBe("20128");
    expect(env.HOSTNAME).toBe("0.0.0.0");
    expect(env.NINEROUTER_SKIP_UPDATE).toBe("1");
  });

  it("leaves the key out entirely when --skip-update was not passed", () => {
    const env = buildServerEnv({ baseEnv, port: 20128, host: "127.0.0.1", skipUpdate: false });

    // `undefined` would reach the child as the string "undefined", which Node
    // then treats as a set variable.
    expect("NINEROUTER_SKIP_UPDATE" in env).toBe(false);
  });

  it("keeps the inherited environment", () => {
    const env = buildServerEnv({ baseEnv, port: 20128, host: "127.0.0.1", skipUpdate: false });

    expect(env.PATH).toBe("/usr/bin");
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildDisciplineLock } from "../../open-sse/utils/disciplineLock.js";

const BAD_REQUEST = 400;

function setup(impl) {
  const markAccountUnavailable = vi.fn(impl || (() => Promise.resolve({ shouldFallback: true })));
  const onError = vi.fn();
  const lock = buildDisciplineLock({
    markAccountUnavailable,
    connectionId: "conn-1",
    provider: "oc",
    model: "mimo-v2.5-free",
    status: BAD_REQUEST,
    onError,
  });
  return { lock, markAccountUnavailable, onError };
}

describe("discipline lock callback wiring", () => {
  it("locks the account with the exact argument order the auth service expects", async () => {
    const { lock, markAccountUnavailable } = setup();

    await lock("doubled-json");

    expect(markAccountUnavailable).toHaveBeenCalledTimes(1);
    expect(markAccountUnavailable).toHaveBeenCalledWith(
      "conn-1",
      BAD_REQUEST,
      "Malformed model output: doubled-json",
      "oc",
      "mimo-v2.5-free"
    );
  });

  it("carries the strike kind into the lock reason", async () => {
    const { lock, markAccountUnavailable } = setup();

    await lock("echo");

    expect(markAccountUnavailable.mock.calls[0][2]).toBe("Malformed model output: echo");
  });

  it("swallows a rejected lock so a failed demotion cannot break the stream", async () => {
    const boom = new Error("db offline");
    const { lock, onError } = setup(() => Promise.reject(boom));

    await expect(lock("doubled-json")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("survives a throwing error handler", async () => {
    const markAccountUnavailable = vi.fn(() => Promise.reject(new Error("down")));
    const lock = buildDisciplineLock({
      markAccountUnavailable,
      connectionId: "conn-2",
      provider: "oc",
      model: "m",
      status: BAD_REQUEST,
      onError: () => {
        throw new Error("logger exploded");
      },
    });

    await expect(lock("doubled-json")).resolves.toBeUndefined();
  });
});

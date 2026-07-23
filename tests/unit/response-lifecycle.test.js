import { describe, expect, it, vi } from "vitest";

import { bindResponseLifecycle } from "../../open-sse/utils/responseLifecycle.js";

describe("response lifecycle binding", () => {
  it("preserves response metadata and settles after normal EOF", async () => {
    const onSettled = vi.fn();
    const response = new Response("hello", {
      status: 201,
      statusText: "Created",
      headers: { "X-Test": "preserved" },
    });

    const bound = bindResponseLifecycle(response, onSettled);

    expect(bound.status).toBe(201);
    expect(bound.statusText).toBe("Created");
    expect(bound.headers.get("x-test")).toBe("preserved");
    expect(onSettled).not.toHaveBeenCalled();
    await expect(bound.text()).resolves.toBe("hello");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles once when the downstream reader cancels", async () => {
    const onSettled = vi.fn();
    const response = new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
      },
    }));
    const bound = bindResponseLifecycle(response, onSettled);
    const reader = bound.body.getReader();

    await reader.read();
    await reader.cancel("client_closed");
    await reader.cancel("duplicate_cancel");

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles once when the source stream errors", async () => {
    const onSettled = vi.fn();
    const expectedError = new Error("upstream failed");
    const response = new Response(new ReadableStream({
      pull() {
        throw expectedError;
      },
    }));
    const bound = bindResponseLifecycle(response, onSettled);
    const reader = bound.body.getReader();

    await expect(reader.read()).rejects.toThrow("upstream failed");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles immediately for a bodyless response", () => {
    const onSettled = vi.fn();
    const response = new Response(null, { status: 204 });

    expect(bindResponseLifecycle(response, onSettled)).toBe(response);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("does not replace the response outcome when cleanup throws", async () => {
    const response = bindResponseLifecycle(
      new Response("ok"),
      () => {
        throw new Error("cleanup failed");
      },
    );

    await expect(response.text()).resolves.toBe("ok");
  });
});

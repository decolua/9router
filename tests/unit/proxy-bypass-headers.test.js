import { describe, expect, it, vi } from "vitest";
import { createBypassRequest } from "../../open-sse/utils/proxyFetch.js";
import { EventEmitter } from "events";
import { Readable } from "stream";

describe("createBypassRequest headers compliance (OSC-002)", () => {
  it("returns standard Headers instance supporting case-insensitive lookup", async () => {
    const net = await import("net");
    const https = await import("https");

    // Mock socket that immediately connects
    const mockSocket = new EventEmitter();
    mockSocket.connect = vi.fn((port, ip, cb) => {
      process.nextTick(cb);
      return mockSocket;
    });

    vi.spyOn(net.default ?? net, "Socket").mockImplementation(() => mockSocket);

    // Mock https response with lowercase Node HTTP headers
    const mockRes = new Readable({
      read() {
        this.push(Buffer.from("{\"ok\":true}"));
        this.push(null);
      }
    });
    mockRes.statusCode = 200;
    mockRes.statusMessage = "OK";
    mockRes.headers = {
      "content-type": "application/json",
      "x-custom-header": "test-val",
      "set-cookie": ["cookie1=val1", "cookie2=val2"]
    };

    const mockReq = new EventEmitter();
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();

    vi.spyOn(https.default ?? https, "request").mockImplementation((options, callback) => {
      process.nextTick(() => callback(mockRes));
      return mockReq;
    });

    const parsedUrl = new URL("https://cloudcode-pa.googleapis.com/v1/models");
    const response = await createBypassRequest(parsedUrl, "127.0.0.1", { method: "POST" });

    // Invariant 1: response.headers must be an instance of Headers
    expect(response.headers).toBeInstanceOf(Headers);

    // Invariant 2: Case-insensitive lookups must work
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("CONTENT-TYPE")).toBe("application/json");
    expect(response.headers.get("X-Custom-Header")).toBe("test-val");

    // Invariant 3: has() and get()
    expect(response.headers.has("Content-Type")).toBe(true);
    expect(response.headers.has("non-existent")).toBe(false);

    vi.restoreAllMocks();
  });
});

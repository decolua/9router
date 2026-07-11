import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const socksCreateConnection = vi.fn();
const tlsConnect = vi.fn();

vi.mock("socks", () => ({
  SocksClient: {
    createConnection: socksCreateConnection,
  },
}));

vi.mock("node:tls", () => ({
  connect: tlsConnect,
}));

function mockSocket() {
  return { kind: "plain-socket" };
}

function mockTlsSocket() {
  const socket = new EventEmitter();
  socket.kind = "tls-socket";
  return socket;
}

describe("createSocksConnector", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    socksCreateConnection.mockResolvedValue({ socket: mockSocket() });
  });

  it("uses SOCKS5 and remote hostname for socks5h proxies", async () => {
    const { createSocksConnector } = await import("../../open-sse/utils/proxyFetch.js");
    const connect = createSocksConnector("socks5h://user%40x:p%40ss@127.0.0.1:40000");
    const callback = vi.fn();

    await connect({
      protocol: "http:",
      hostname: "example.com",
      port: "80",
    }, callback);

    expect(socksCreateConnection).toHaveBeenCalledWith({
      proxy: {
        host: "127.0.0.1",
        port: 40000,
        type: 5,
        userId: "user@x",
        password: "p@ss",
      },
      command: "connect",
      destination: {
        host: "example.com",
        port: 80,
      },
    });
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ kind: "plain-socket" }));
    expect(tlsConnect).not.toHaveBeenCalled();
  });

  it("uses SOCKS4 type for socks4a proxies", async () => {
    const { createSocksConnector } = await import("../../open-sse/utils/proxyFetch.js");
    const connect = createSocksConnector("socks4a://127.0.0.1:1080");
    const callback = vi.fn();

    await connect({
      protocol: "http:",
      hostname: "example.com",
      port: "8080",
    }, callback);

    expect(socksCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      proxy: expect.objectContaining({ type: 4, host: "127.0.0.1", port: 1080 }),
      destination: { host: "example.com", port: 8080 },
    }));
  });

  it("wraps the SOCKS socket with TLS for https destinations", async () => {
    const tlsSocket = mockTlsSocket();
    tlsConnect.mockReturnValue(tlsSocket);
    const { createSocksConnector } = await import("../../open-sse/utils/proxyFetch.js");
    const connect = createSocksConnector("socks5://127.0.0.1:40000");
    const callback = vi.fn();

    const pending = connect({
      protocol: "https:",
      hostname: "api.x.ai",
      port: "443",
      servername: "api.x.ai",
    }, callback);

    // secureConnect is async relative to connector await
    await pending;
    tlsSocket.emit("secureConnect");

    expect(tlsConnect).toHaveBeenCalledWith({
      socket: expect.objectContaining({ kind: "plain-socket" }),
      servername: "api.x.ai",
      ALPNProtocols: ["http/1.1"],
    });
    expect(callback).toHaveBeenCalledWith(null, tlsSocket);
  });

  it("forwards SOCKS connection failures to the undici callback", async () => {
    socksCreateConnection.mockRejectedValue(new Error("socks down"));
    const { createSocksConnector } = await import("../../open-sse/utils/proxyFetch.js");
    const connect = createSocksConnector("socks5h://127.0.0.1:40000");
    const callback = vi.fn();

    await connect({
      protocol: "https:",
      hostname: "example.com",
    }, callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: "socks down" }), null);
    expect(tlsConnect).not.toHaveBeenCalled();
  });
});

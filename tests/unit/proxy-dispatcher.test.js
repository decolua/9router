import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAgentConstructor = vi.fn();
const agentConstructor = vi.fn();
const socksCreateConnection = vi.fn();
const tlsConnect = vi.fn();

vi.mock("undici", () => ({ ProxyAgent: proxyAgentConstructor, Agent: agentConstructor }));
vi.mock("socks", () => ({ SocksClient: { createConnection: socksCreateConnection } }));
vi.mock("node:tls", () => ({ connect: tlsConnect }));

describe("proxyDispatcher", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    proxyAgentConstructor.mockImplementation(function ProxyAgent(options) { return { kind: "http", options }; });
    agentConstructor.mockImplementation(function Agent(options) { return { kind: "socks", options }; });
    socksCreateConnection.mockResolvedValue({ socket: { kind: "plain" } });
  });

  it("normalizes host-port and identifies SOCKS schemes", async () => {
    const { normalizeProxyUrl, isSocksProxyUrl } = await import("@/lib/network/proxyDispatcher");
    expect(normalizeProxyUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(isSocksProxyUrl("socks5h://127.0.0.1:40000")).toBe(true);
    expect(isSocksProxyUrl("https://127.0.0.1:8443")).toBe(false);
  });

  it("rejects unsupported proxy protocols", async () => {
    const { createProxyDispatcher } = await import("@/lib/network/proxyDispatcher");
    await expect(createProxyDispatcher("ftp://example.com")).rejects.toThrow("Unsupported proxy protocol");
  });

  it("selects ProxyAgent for HTTP and Agent for SOCKS", async () => {
    const { createProxyDispatcher } = await import("@/lib/network/proxyDispatcher");
    await createProxyDispatcher("https://127.0.0.1:8443");
    await createProxyDispatcher("socks5h://127.0.0.1:40000");
    expect(proxyAgentConstructor).toHaveBeenCalledWith({ uri: "https://127.0.0.1:8443" });
    expect(agentConstructor).toHaveBeenCalledWith({ connect: expect.any(Function) });
  });

  it.each(["socks5:", "socks5h:", "socks4:", "socks4a:"])("keeps destination hostname for %s", async (scheme) => {
    const { createSocksConnector } = await import("@/lib/network/proxyDispatcher");
    const callback = vi.fn();
    await createSocksConnector(`${scheme}//127.0.0.1:40000`)({ protocol: "http:", hostname: "example.com", port: "80" }, callback);
    expect(socksCreateConnection).toHaveBeenCalledWith(expect.objectContaining({ destination: { host: "example.com", port: 80 } }));
  });

  it("wraps HTTPS with hostname and certificate verification", async () => {
    const tlsSocket = new EventEmitter();
    tlsConnect.mockReturnValue(tlsSocket);
    const { createSocksConnector } = await import("@/lib/network/proxyDispatcher");
    const callback = vi.fn();
    await createSocksConnector("socks5h://127.0.0.1:40000")({ protocol: "https:", hostname: "api.x.ai", port: "443" }, callback);
    tlsSocket.emit("secureConnect");
    expect(tlsConnect).toHaveBeenCalledWith(expect.objectContaining({
      servername: "api.x.ai",
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"],
    }));
    expect(callback).toHaveBeenCalledWith(null, tlsSocket);
  });

  it("destroys dispatchers before falling back to close", async () => {
    const { disposeProxyDispatcher } = await import("@/lib/network/proxyDispatcher");
    const destroy = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    disposeProxyDispatcher({ destroy, close });
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});

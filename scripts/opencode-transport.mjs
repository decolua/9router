const token = process.env.OPENCODE_TRANSPORT_TOKEN || "";
const port = Number(process.env.OPENCODE_TRANSPORT_PORT || 0);

function forwardableHeaders(input) {
  const headers = {};
  for (const [key, value] of Object.entries(input || {})) {
    const name = key.toLowerCase();
    if (name === "host" || name === "content-length" || name === "connection") continue;
    if (name === "accept-encoding" || name === "transfer-encoding") continue;
    if (value == null) continue;
    headers[key] = String(value);
  }
  return headers;
}

function responseHeaders(input) {
  const headers = new Headers();
  input.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "content-encoding" || name === "content-length") return;
    if (name === "transfer-encoding" || name === "connection") return;
    headers.set(key, value);
  });
  return headers;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/forward" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    if (token && request.headers.get("x-transport-token") !== token) {
      return new Response("forbidden", { status: 403 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (!payload?.url) return new Response("bad request", { status: 400 });

    const options = {
      method: payload.method || "POST",
      headers: forwardableHeaders(payload.headers),
      body: payload.body ?? undefined,
      redirect: "manual",
    };
    options.headers["accept-encoding"] = "identity";
    if (payload.proxy) options.proxy = payload.proxy;

    let upstream;
    try {
      upstream = await fetch(payload.url, options);
    } catch (error) {
      return Response.json(
        { error: String(error?.message || error) },
        { status: 502, headers: { "x-transport-error": "1" } }
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers),
    });
  },
});

console.log(`READY ${server.port}`);

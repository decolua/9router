const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function kiroFrame(type, payload, raw = false) {
  const name = encoder.encode(":event-type");
  const value = encoder.encode(type);
  const header = new Uint8Array(1 + name.length + 3 + value.length);
  header[0] = name.length;
  header.set(name, 1);
  header[1 + name.length] = 7;
  new DataView(header.buffer).setUint16(2 + name.length, value.length);
  header.set(value, 4 + name.length);
  const body = encoder.encode(raw ? payload : JSON.stringify(payload));
  const bytes = new Uint8Array(16 + header.length + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  view.setUint32(4, header.length);
  bytes.set(header, 12);
  bytes.set(body, 12 + header.length);
  view.setUint32(8, crc32(bytes.subarray(0, 8)));
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(0, -4)));
  return bytes;
}
export function nativeResponse({ credits = 10, metrics, stop = "end_turn", extra = [] } = {}) {
  const frames = [kiroFrame("assistantResponseEvent", { content: "A complete answer." }),
    kiroFrame("metricsEvent", metrics || { inputTokens: 10000, outputTokens: 20 }),
    ...(credits === undefined ? [] : [kiroFrame("meteringEvent", { usage: credits, unit: "credit" })]),
    kiroFrame("messageStopEvent", { stopReason: stop }), ...extra];
  return new Response(new ReadableStream({ start(c) {
    frames.forEach(f => c.enqueue(f)); c.close();
  } }));
}
export function sseEvents(text) {
  return text.split("\n").filter(l => l.startsWith("data: ") && l !== "data: [DONE]")
    .map(l => JSON.parse(l.slice(6)));
}

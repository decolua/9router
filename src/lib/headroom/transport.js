import dns from "node:dns";
import { Agent } from "undici";
import { assertPublicUrl } from "../../shared/utils/ssrfGuard.js";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHeadroomUrl(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && loopback.has(url.hostname);
  } catch { return false; }
}

export function validateHeadroomUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Headroom URL must use HTTP or HTTPS");
  if (!loopback.has(url.hostname)) assertPublicUrl(url.href);
  return url;
}

// Validate the actual answers passed to the socket. Never resolve a second time
// or allow the gateway's ambient proxy to resolve the name on our behalf.
export function headroomLookup(host, options, callback) {
  const finish = (answers) => options.all ? callback(null, answers) : callback(null, answers[0].address, answers[0].family);
  if (host === "localhost") return finish([{ address: "127.0.0.1", family: 4 }]);
  dns.lookup(host, { all: true, verbatim: true }, (err, answers) => {
    if (err) return callback(err);
    try {
      if (!answers.length) throw new Error("No Headroom address");
      for (const { address, family } of answers) assertPublicUrl("http://" + (family === 6 ? "[" + address + "]" : address));
    } catch (error) { return callback(error); }
    finish(answers);
  });
}

const dispatcher = new Agent({ connect: { lookup: headroomLookup } });
export function fetchHeadroom(raw, init) {
  const url = validateHeadroomUrl(raw);
  return fetch(url.href, { ...init, dispatcher, redirect: "error" });
}

export function headroomEndpoint(raw, suffix) {
  const url = validateHeadroomUrl(raw);
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + suffix;
  url.hash = "";
  return url;
}

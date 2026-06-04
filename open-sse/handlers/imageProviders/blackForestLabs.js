// Black Forest Labs (FLUX) — async submit + polling_url
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";

const BASE_URL = "https://api.bfl.ai/v1";

export default {
  async: true,
  buildUrl: (model) => `${BASE_URL}/${model}`,
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    return { "Content-Type": "application/json", "x-key": key };
  },
  buildBody: (_model, body) => {
    const req = { prompt: body.prompt };
    if (body.size) {
      const [w, h] = body.size.split("x").map(Number);
      if (w) req.width = w;
      if (h) req.height = h;
    }
    if (body.image) req.image_prompt = body.image;
    return req;
  },
  async parseResponse(response, { headers }) {
    const data = await response.json();
    const pollingUrl = data.polling_url;
    if (!pollingUrl) throw new Error("BFL: no polling_url returned");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(pollingUrl, { headers: { "x-key": headers["x-key"], "Accept": "application/json" } });
      if (!r.ok) throw new Error(`BFL status ${r.status}`);
      const s = await r.json();
      if (s.status === "Ready") return s;
      if (s.status === "Error" || s.status === "Failed") throw new Error(s.error || "BFL generation failed");
    }
    throw new Error("BFL polling timeout");
  },
  normalize: (responseBody) => {
    const sample = responseBody.result?.sample;
    if (sample) return { created: nowSec(), data: [{ url: sample }] };
    return { created: nowSec(), data: [] };
  },
};

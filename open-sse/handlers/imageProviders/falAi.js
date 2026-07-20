// Fal.ai — async submit + queue polling
import { fetchRemoteJson, readBoundedJsonResponse, sleep, nowSec, sizeToAspectRatio, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["fal-ai"]?.imageConfig?.baseUrl;

export default {
  async: true,
  buildUrl: (model) => `${BASE_URL}/${model}`,
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    return { "Content-Type": "application/json", "Authorization": `Key ${key}` };
  },
  buildBody: (_model, body) => {
    const req = { prompt: body.prompt, num_images: body.n || 1 };
    if (body.size) req.image_size = sizeToAspectRatio(body.size);
    if (body.image) req.image_url = body.image;
    return req;
  },
  async parseResponse(response, { headers, proxyOptions, url }) {
    const { status_url, response_url } = await readBoundedJsonResponse(response);
    const expectedOrigin = new URL(url || BASE_URL).origin;
    if (new URL(status_url).origin !== expectedOrigin || new URL(response_url).origin !== expectedOrigin) {
      throw new Error("Fal polling URL origin is not allowed");
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const s = await fetchRemoteJson(status_url, { expectedOrigin, headers, proxyOptions });
      if (s.status === "COMPLETED") {
        return fetchRemoteJson(response_url, { expectedOrigin, headers, proxyOptions });
      }
      if (s.status === "FAILED") throw new Error(s.error || "Fal generation failed");
    }
    throw new Error("Fal polling timeout");
  },
  normalize: (responseBody) => {
    const images = Array.isArray(responseBody.images)
      ? responseBody.images
      : (responseBody.image ? [responseBody.image] : []);
    return { created: nowSec(), data: images.map((img) => ({ url: img.url || img })) };
  },
};

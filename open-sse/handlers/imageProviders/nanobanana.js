// NanoBanana API — async submit + poll record-info
import { sleep, nowSec, sizeToAspectRatio, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";

const SUBMIT_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate";
const POLL_BASE = "https://api.nanobananaapi.ai/api/v1/nanobanana/record-info";

export default {
  async: true,
  buildUrl: () => SUBMIT_URL,
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (_model, body) => {
    const ratio = sizeToAspectRatio(body.size);
    const isEdit = !!(body.image || (Array.isArray(body.images) && body.images.length));
    const req = {
      prompt: body.prompt,
      type: isEdit ? "IMAGETOIAMGE" : "TEXTTOIAMGE",
      numImages: body.n || 1,
      image_size: ratio,
      // API requires callBackUrl; we poll instead so a dummy URL is fine.
      callBackUrl: "https://localhost/callback",
    };
    if (isEdit) {
      const urls = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
      if (body.image) urls.push(body.image);
      req.imageUrls = urls;
    }
    return req;
  },
  // Async: parse submit → poll until SUCCESS, return raw poll data
  async parseResponse(response, { headers }) {
    const submitData = await response.json();
    if (submitData.code !== 200) throw new Error(submitData.msg || "NanoBanana submit failed");
    const taskId = submitData.data?.taskId;
    if (!taskId) throw new Error("NanoBanana: no taskId returned");
    const pollUrl = `${POLL_BASE}?taskId=${encodeURIComponent(taskId)}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(pollUrl, { headers });
      if (!r.ok) throw new Error(`NanoBanana status ${r.status}`);
      const s = await r.json();
      const flag = s.data?.successFlag;
      if (flag === 1) return s.data;
      if (flag === 2 || flag === 3) throw new Error(s.data?.errorMessage || "NanoBanana generation failed");
    }
    throw new Error("NanoBanana polling timeout");
  },
  normalize: (responseBody, prompt) => {
    const url = responseBody.response?.resultImageUrl || responseBody.response?.originImageUrl;
    if (url) return { created: nowSec(), data: [{ url, revised_prompt: prompt }] };
    return { created: nowSec(), data: [] };
  },
};

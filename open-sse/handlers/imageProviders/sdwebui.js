// SD WebUI (AUTOMATIC1111) — local, noAuth
import { nowSec } from "./_base.js";

export default {
  noAuth: true,
  buildUrl: () => "http://localhost:7860/sdapi/v1/txt2img",
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model, body) => {
    const { prompt, n = 1, size = "1024x1024" } = body;
    const [width, height] = size.split("x").map(Number);
    return { prompt, width: width || 512, height: height || 512, steps: 20, batch_size: n };
  },
  normalize: (responseBody) => {
    const images = Array.isArray(responseBody.images) ? responseBody.images.map((img) => ({ b64_json: img })) : [];
    return { created: nowSec(), data: images };
  },
};

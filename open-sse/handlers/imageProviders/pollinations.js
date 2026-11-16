import { pollinationsHeaders } from "../../services/pollinationsModels.js";

function references(body) {
  return [body.image, body.images].flat().filter((value) => value != null);
}

export default {
  buildUrl: (_model, _credentials, body) => `https://gen.pollinations.ai/v1/images/${references(body).length ? "edits" : "generations"}`,
  buildHeaders: (credentials) => ({ "Content-Type": "application/json", ...pollinationsHeaders(credentials) }),
  buildBody(model, body) {
    if (body.n != null && Number(body.n) !== 1) throw new Error("Pollinations supports one image per request (n=1)");
    if (body.mask != null) throw new Error("Pollinations does not support image masks");
    const images = references(body).map((ref) => {
      const url = typeof ref === "string" ? ref : ref?.image_url?.url ?? ref?.image_url;
      if (typeof url !== "string" || !/^(https?:\/\/|data:image\/)/i.test(url)) throw new Error("Pollinations image references must be HTTP(S) URLs or image data URIs");
      return { image_url: url };
    });
    const { image, images: ignored, ...rest } = body;
    return { ...rest, model, ...(images.length ? { image: images } : {}) };
  },
  normalize: (body) => body,
};

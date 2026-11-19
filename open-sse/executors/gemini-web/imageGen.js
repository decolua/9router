// Gemini Web image generation (DOM capture).
//
// Ask the web UI to generate an image, wait for the generated <img> to land in
// the reply bubble (the "Creating your image" phase keeps the thinking overlay
// up — reuse that marker as the still-working signal), then download the
// (possibly blob:) image in-page as base64. Verified live: 1024×572 blob image
// in ~26s.

const POLL_INTERVAL_MS = 1000;
const IMAGE_TIMEOUT_MS = 120000;
const FIRST_TOKEN_TIMEOUT_MS = 30000;
const MIN_IMAGE_EDGE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const READ_IMAGE_STATE = `(() => {
  const msgs = [...document.querySelectorAll('model-response, message-content')];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const imgs = last
    ? [...last.querySelectorAll('img')].map((i) => ({
        src: i.currentSrc || i.src || '',
        w: i.naturalWidth || 0,
        h: i.naturalHeight || 0,
      }))
    : [];
  return {
    count: msgs.length,
    generating: !!document.querySelector('[data-test-id="thinking-overlay-content"], button[aria-label*="Stop" i]'),
    images: imgs.filter((i) => i.src && !i.src.includes('gstatic') && i.w > 0),
  };
})()`;

async function readImageState(page) {
  try {
    return (
      (await page.evaluate(READ_IMAGE_STATE)) || { count: 0, generating: false, images: [] }
    );
  } catch {
    return { count: 0, generating: false, images: [] };
  }
}

async function fetchImageAsBase64(page, src) {
  const result = await page.evaluate(async (url) => {
    // data: URL — decode directly
    if (url.startsWith("data:")) {
      const r = await fetch(url);
      const blob = await r.blob();
      return { ok: true, mime: blob.type || "image/png", b64: url.slice(url.indexOf(",") + 1) };
    }
    // blob:/same-origin images render untainted — canvas gives the bytes
    // without a network round-trip (the blob may already be revoked).
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("img load failed"));
        el.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      return { ok: true, mime: "image/png", b64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    } catch {
      /* fall through to fetch */
    }
    try {
      const response = await fetch(url);
      if (!response.ok) return { ok: false, err: `status ${response.status}` };
      const blob = await response.blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      return { ok: true, mime: blob.type || "image/png", b64: btoa(s) };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  }, src);
  if (!result?.ok) throw new Error(`failed to download generated image: ${result?.err}`);
  return { b64: result.b64, mime: result.mime };
}

export function buildImagePrompt(prompt, size) {
  const hints = size ? ` (aspect ratio ${size})` : "";
  return `Generate an image${hints}: ${prompt}`;
}

/**
 * Wait for the generated image inside the reply that follows the just-sent
 * message and return it as base64. Completion: an <img> with a real
 * (non-gstatic, loaded) source is present and the turn is no longer working.
 */
export async function waitForGeminiImage(page, { timeoutMs = IMAGE_TIMEOUT_MS, signal }) {
  const started = Date.now();
  let sawActivity = false;

  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    if (Date.now() - started > timeoutMs) throw new Error("Gemini image generation timed out");
    await sleep(POLL_INTERVAL_MS);

    const st = await readImageState(page);
    if (st.count > 0 || st.generating) sawActivity = true;
    if (!sawActivity && Date.now() - started > FIRST_TOKEN_TIMEOUT_MS) {
      throw new Error("no first sign of activity from Gemini");
    }

    const ready = st.images.filter((i) => i.w >= MIN_IMAGE_EDGE);
    if (ready.length > 0 && !st.generating) {
      const image = ready[ready.length - 1];
      const media = await fetchImageAsBase64(page, image.src);
      return { ...media, width: image.w, height: image.h };
    }
  }
}

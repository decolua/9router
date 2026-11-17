// Qoder image adapter — Cloud Agents ImageGen tool (text-to-image and edits).
// Needs a PAT connection (pt-...): the Cloud Agents API rejects job tokens and IDE logins.
import { nowSec, urlToBase64 } from "./_base.js";
import { fetchImageAsBase64 } from "../../translator/concerns/image.js";
import { QODER_IMAGE_CONFIG, QODER_IMAGE_DEFAULT_SIZE, QODER_IMAGE_SIZES } from "../../shared/qoder/constants.js";
import {
  QoderCloudError,
  archiveSession,
  createSession,
  deleteFile,
  ensureImageSetup,
  fileContentUrl,
  forgetImageSetup,
  mountFile,
  qoderPatOf,
  sendUserMessage,
  uploadFile,
  waitForArtifacts,
} from "../../shared/qoder/cloudAgents.js";

const NOT_PAT_MESSAGE =
  "Qoder image generation needs a Personal Access Token connection (pt-...); OAuth logins cannot use the Cloud Agents API";

const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Closest ImageGen size for an aspect ratio (w/h), compared on a log scale. */
function nearestSize(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const target = Math.log(width / height);
  let best = null;
  let bestDistance = Infinity;
  for (const size of QODER_IMAGE_SIZES) {
    const [w, h] = size.split("x").map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = size;
    }
  }
  return best;
}

/** ImageGen size from `aspect_ratio` ("16:9") or `size` ("1792x1024"/"1920x1080"), else 1024x1024. */
export function resolveQoderImageSize(body = {}) {
  const ratio = String(body.aspect_ratio || "").match(/^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/);
  if (ratio) return nearestSize(Number(ratio[1]), Number(ratio[2])) || QODER_IMAGE_DEFAULT_SIZE;
  const size = String(body.size || "").trim().toLowerCase();
  if (QODER_IMAGE_SIZES.includes(size)) return size;
  const dims = size.match(/^(\d{2,5})x(\d{2,5})$/);
  if (dims) return nearestSize(Number(dims[1]), Number(dims[2])) || QODER_IMAGE_DEFAULT_SIZE;
  return QODER_IMAGE_DEFAULT_SIZE;
}

function collectImageInputs(body) {
  return [body.image, body.images, body.reference_images, body.reference_image]
    .flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .map((v) => (v && typeof v === "object" ? v.image_url?.url || v.url || v.b64_json || v.data : v))
    .filter((v) => typeof v === "string" && v.length > 0);
}

function parseDataUri(value) {
  const m = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  return m ? { mimeType: m[1].toLowerCase(), bytes: Buffer.from(m[2], "base64") } : null;
}

/** Reference images as bytes. URLs go through the SSRF-hardened fetcher; anything unreadable is a 400. */
async function resolveInputImages(body) {
  const inputs = collectImageInputs(body);
  if (inputs.length > QODER_IMAGE_CONFIG.maxInputImages) {
    throw new QoderCloudError(400, `Qoder image edits accept at most ${QODER_IMAGE_CONFIG.maxInputImages} input images`);
  }
  const images = [];
  for (const input of inputs) {
    let image = null;
    if (input.startsWith("data:")) {
      image = parseDataUri(input);
    } else if (/^https?:\/\//i.test(input)) {
      const fetched = await fetchImageAsBase64(input);
      image = fetched ? parseDataUri(fetched.url) : null;
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(input) && input.length > 100) {
      image = { mimeType: "image/png", bytes: Buffer.from(input, "base64") };
    }
    if (!image || !image.bytes.length) throw new QoderCloudError(400, "Could not read an input image (use a data URI, base64 or a public http(s) URL)");
    images.push(image);
  }
  return images;
}

function instruction(prompt, size, paths) {
  return [
    "Generate exactly one image with the ImageGen tool, then deliver it with DeliverArtifacts.",
    "Tool parameters:",
    `- size: ${size}`,
    ...(paths.length ? [`- images: ${JSON.stringify(paths)} (input images to edit/compose, already in your sandbox)`] : []),
    "",
    "Pass the prompt below to the tool exactly as written (verbatim: do not rewrite, translate, shorten or extend it).",
    "",
    "Prompt:",
    prompt,
  ].join("\n");
}

async function generateOne(pat, setupIds, { prompt, size, uploads }) {
  const session = await createSession(pat, { ...setupIds, title: "9router image" });
  try {
    const paths = [];
    for (const [i, upload] of uploads.entries()) {
      const path = `${QODER_IMAGE_CONFIG.inputMountDir}/input-${i + 1}.${upload.ext}`;
      await mountFile(pat, session.id, upload.fileId, path);
      paths.push(path);
    }
    await sendUserMessage(pat, session.id, instruction(prompt, size, paths));
    const { artifacts, credits } = await waitForArtifacts(pat, session.id);
    const image = artifacts.find((a) => String(a.contentType || "").startsWith("image/")) || artifacts[0];
    return { url: await fileContentUrl(pat, image.fileId), credits };
  } finally {
    await archiveSession(pat, session.id);
  }
}

export default {
  useExecutor: true,

  // Stubs required by imageGenerationCore's interface; unused with useExecutor.
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  // OAuth / job-token connections stay usable for chat but are skipped for images.
  canUseCredentials: (credentials) => qoderPatOf(credentials) !== null,
  unusableCredentialsReason: "not a PAT connection (Cloud Agents need pt-...)",
  unusableCredentialsMessage: NOT_PAT_MESSAGE,

  async executeViaExecutor(model, body, credentials, log, { onUsage } = {}) {
    const pat = qoderPatOf(credentials);
    if (!pat) throw new QoderCloudError(403, NOT_PAT_MESSAGE);

    const size = resolveQoderImageSize(body);
    const n = Math.min(Math.max(Number.parseInt(body.n, 10) || 1, 1), QODER_IMAGE_CONFIG.maxImagesPerRequest);
    const inputImages = await resolveInputImages(body);

    let setupIds = await ensureImageSetup(pat);
    const uploads = [];
    try {
      for (const [i, image] of inputImages.entries()) {
        const ext = EXT_BY_MIME[image.mimeType] || "png";
        const file = await uploadFile(pat, { bytes: image.bytes, filename: `input-${i + 1}.${ext}`, mimeType: image.mimeType });
        uploads.push({ fileId: file.id, ext });
      }

      const results = [];
      for (let i = 0; i < n; i++) {
        log?.debug?.("IMAGE", `QODER | ${model} | ${size} | image ${i + 1}/${n}${uploads.length ? ` | ${uploads.length} input(s)` : ""}`);
        try {
          results.push(await generateOne(pat, setupIds, { prompt: body.prompt, size, uploads }));
        } catch (error) {
          // Agent/environment archived upstream since we cached it: recreate once.
          if (error?.status !== 404 || i > 0) throw error;
          forgetImageSetup(pat);
          setupIds = await ensureImageSetup(pat);
          results.push(await generateOne(pat, setupIds, { prompt: body.prompt, size, uploads }));
        }
      }

      // Qoder bills in credits, not tokens: record the request (0 tokens) and keep the credits alongside.
      if (onUsage) {
        const credited = results.filter((r) => r.credits !== null);
        const qoderCredits = credited.length ? Math.round(credited.reduce((sum, r) => sum + r.credits, 0) * 10000) / 10000 : undefined;
        await onUsage({ prompt_tokens: 0, completion_tokens: 0, ...(qoderCredits !== undefined ? { qoder_credits: qoderCredits } : {}) });
      }

      const data = body.response_format === "b64_json"
        ? await Promise.all(results.map(async ({ url }) => ({ b64_json: await urlToBase64(url) })))
        : results.map(({ url }) => ({ url }));
      return { created: nowSec(), data };
    } finally {
      for (const upload of uploads) await deleteFile(pat, upload.fileId);
    }
  },

  normalize: (responseBody) => responseBody,
};

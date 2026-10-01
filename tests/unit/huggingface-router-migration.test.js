/**
 * HuggingFace registry migration to router.huggingface.co
 *
 * The legacy base URL `https://api-inference.huggingface.co` no longer resolves
 * (DNS ENOTFOUND), so every HuggingFace image/STT request failed at the fetch
 * layer. The replacement is `https://router.huggingface.co`, which routes by
 * `<provider>/<providerResolvedModelId>` — the provider-resolved id is NOT the
 * Hub model id and must be resolved from the Hub API's inferenceProviderMapping.
 *
 * Covers:
 *  - imageConfig base URL is the live router host, not the dead legacy host
 *  - image URL builder emits the provider-resolved id, not the Hub id
 *  - image URL builder throws a descriptive error for unmapped models
 *  - sttConfig exists and points at the live router host
 *  - every registered public model resolves through a provider the router serves
 */

import { describe, it, expect } from "vitest";
import huggingface from "../../open-sse/providers/registry/huggingface.js";
import imageAdapter from "../../open-sse/handlers/imageProviders/huggingface.js";

const DEAD_HOST = "api-inference.huggingface.co";
const LIVE_ROUTER = "router.huggingface.co";

// Providers the router actually forwards to. replicate/wavespeed/deepinfra appear
// in the Hub's inferenceProviderMapping but reject every router request with
// "Model not supported by provider <name>", so they must not be used here.
const ROUTABLE_PROVIDERS = new Set(["fal-ai", "hf-inference", "nscale", "together", "novita", "hyperbolic"]);

const imageConfig = huggingface.imageConfig;
const modelMap = imageConfig.modelMap || {};

// modelMap values are either a bare path (text-to-image) or
// { path, task: "image-to-image" } for models that require a source image.
const mappingPath = (value) => (typeof value === "string" ? value : value.path);
const mappingTask = (value) => (typeof value === "string" ? "text-to-image" : value.task || "text-to-image");

describe("HuggingFace registry — legacy host removal", () => {
  it("does not use the dead api-inference host for images", () => {
    expect(imageConfig.baseUrl).not.toContain(DEAD_HOST);
  });

  it("points imageConfig at the live router host", () => {
    expect(imageConfig.baseUrl).toContain(LIVE_ROUTER);
  });

  it("does not use the dead api-inference host for STT", () => {
    expect(huggingface.sttConfig?.baseUrl).not.toContain(DEAD_HOST);
  });
});

describe("HuggingFace STT dispatch", () => {
  it("declares an sttConfig so sttCore can dispatch", () => {
    expect(huggingface.sttConfig).toBeDefined();
  });

  it("uses the HuggingFace ASR wire format", () => {
    expect(huggingface.sttConfig.format).toBe("huggingface-asr");
  });

  it("authenticates with a bearer API key", () => {
    expect(huggingface.sttConfig.authType).toBe("apikey");
    expect(huggingface.sttConfig.authHeader).toBe("bearer");
  });

  it("advertises stt in serviceKinds", () => {
    expect(huggingface.serviceKinds).toContain("stt");
  });

  it("points sttConfig at the hf-inference model route", () => {
    expect(huggingface.sttConfig.baseUrl).toBe("https://router.huggingface.co/hf-inference/models");
  });
});

describe("HuggingFace image URL builder", () => {
  it("routes FLUX.1-schnell through its fal-ai provider id", () => {
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell")).toBe(
      "https://router.huggingface.co/fal-ai/fal-ai/flux/schnell"
    );
  });

  it("routes SDXL through its fal-ai provider id", () => {
    expect(imageAdapter.buildUrl("stabilityai/stable-diffusion-xl-base-1.0")).toBe(
      "https://router.huggingface.co/fal-ai/fal-ai/fast-sdxl"
    );
  });

  it("never leaks the dead host into a built URL", () => {
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell")).not.toContain(DEAD_HOST);
  });

  it("throws a descriptive error for a model with no provider mapping", () => {
    expect(() => imageAdapter.buildUrl("some-org/not-mapped-model")).toThrow(/no HuggingFace router mapping/i);
  });

  it("lets a connection override the endpoint for a self-hosted model", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal/" } };

    expect(imageAdapter.buildUrl("my-org/my-tgi-model", creds)).toBe("https://tgi.internal/my-org/my-tgi-model");
  });

  it("does not apply the router mapping when a custom endpoint is set", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal" } };

    // The custom endpoint knows its own model ids — the Hub id passes through verbatim.
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell", creds)).toBe(
      "https://tgi.internal/black-forest-labs/FLUX.1-schnell"
    );
  });

  it("ignores a blank custom endpoint", () => {
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell", { providerSpecificData: { baseUrl: "  " } })).toBe(
      "https://router.huggingface.co/fal-ai/fal-ai/flux/schnell"
    );
  });

  it("rejects traversal or query injection in the model id on a custom endpoint", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal" } };

    for (const model of ["x/../../admin", "org//model", "model?x=1", "model#f"]) {
      expect(() => imageAdapter.buildUrl(model, creds), model).toThrow(/invalid model ID/i);
    }
  });
});

describe("HuggingFace registry model table", () => {
  const modelsById = Object.fromEntries(huggingface.models.map((m) => [m.id, m]));
  const imageModels = huggingface.models.filter((m) => m.kind === "image");
  const sttModels = huggingface.models.filter((m) => m.kind === "stt");

  it("every image model is present in imageConfig.modelMap", () => {
    for (const model of imageModels) {
      expect(modelMap[model.id], `model ${model.id} is missing from imageConfig.modelMap`).toBeTruthy();
    }
  });

  it("every modelMap entry points at a routable provider", () => {
    for (const [hubId, value] of Object.entries(modelMap)) {
      const provider = String(mappingPath(value)).split("/")[0];
      expect(ROUTABLE_PROVIDERS.has(provider), `${hubId} -> unsupported provider ${provider}`).toBe(true);
    }
  });

  it("every modelMap entry has a provider/model path shape", () => {
    for (const [hubId, value] of Object.entries(modelMap)) {
      expect(String(mappingPath(value)), `${hubId} has a malformed target`).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._/-]+$/);
    }
  });

  it("does not advertise whisper-small, which has no live provider", () => {
    expect(modelsById["openai/whisper-small"]).toBeUndefined();
  });

  it("advertises whisper-large-v3-turbo as its STT replacement", () => {
    expect(modelsById["openai/whisper-large-v3-turbo"]?.kind).toBe("stt");
  });

  it("exposes the FLUX family image models", () => {
    for (const id of [
      "black-forest-labs/FLUX.1-schnell",
      "black-forest-labs/FLUX.1-dev",
      "black-forest-labs/FLUX.1-Krea-dev",
      "black-forest-labs/FLUX.1-Kontext-dev",
      "black-forest-labs/FLUX.2-dev",
      "black-forest-labs/FLUX.2-klein-9B",
      "black-forest-labs/FLUX.2-klein-4B",
      "black-forest-labs/FLUX.2-klein-base-9B",
      "black-forest-labs/FLUX.2-klein-base-4B",
    ]) {
      expect(modelsById[id]?.kind, `${id} should be registered as an image model`).toBe("image");
    }
  });

  it("exposes the Qwen-Image family", () => {
    for (const id of [
      "Qwen/Qwen-Image",
      "Qwen/Qwen-Image-2512",
      "Qwen/Qwen-Image-Edit",
      "Qwen/Qwen-Image-Edit-2509",
      "Qwen/Qwen-Image-Edit-2511",
    ]) {
      expect(modelsById[id]?.kind, `${id} should be registered as an image model`).toBe("image");
    }
  });

  it("exposes the Stable Diffusion family", () => {
    for (const id of [
      "stabilityai/stable-diffusion-xl-base-1.0",
      "stabilityai/stable-diffusion-3.5-large",
      "stabilityai/stable-diffusion-3.5-large-turbo",
    ]) {
      expect(modelsById[id]?.kind, `${id} should be registered as an image model`).toBe("image");
    }
  });

  it("exposes the HuggingFace ASR models", () => {
    for (const id of ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"]) {
      expect(modelsById[id]?.kind, `${id} should be registered as an stt model`).toBe("stt");
    }
  });

  it("exposes the remaining third-party image models", () => {
    for (const id of [
      "tencent/HunyuanImage-3.0",
      "Tongyi-MAI/Z-Image-Turbo",
      "krea/Krea-2-Turbo",
      "HiDream-ai/HiDream-I1-Fast",
      "playgroundai/playground-v2.5-1024px-aesthetic",
      "ideogram-ai/ideogram-4-fp8",
    ]) {
      expect(modelsById[id]?.kind, `${id} should be registered as an image model`).toBe("image");
    }
  });

  it("keeps the model table free of duplicates", () => {
    const ids = huggingface.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps STT models free of image-only router mappings", () => {
    for (const model of sttModels) {
      expect(modelMap[model.id], `STT model ${model.id} should not be in the image model map`).toBeUndefined();
    }
  });
});

// The router is a switchboard in front of many providers; every Hub model that is
// `pipeline_tag: image-to-image` needs a source image, and the request shape differs
// from text-to-image: `inputs` carries the base64 source image and the prompt moves
// under `parameters.prompt`. Verified against
// https://huggingface.co/docs/inference-providers/tasks/image-to-image
describe("HuggingFace image-to-image models", () => {
  const IMAGE_TO_IMAGE = [
    "black-forest-labs/FLUX.2-dev",
    "black-forest-labs/FLUX.1-Kontext-dev",
    "black-forest-labs/FLUX.2-klein-9B",
    "black-forest-labs/FLUX.2-klein-4B",
    "black-forest-labs/FLUX.2-klein-base-9B",
    "black-forest-labs/FLUX.2-klein-base-4B",
    "Qwen/Qwen-Image-Edit",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit-2511",
  ];

  it("marks every image-to-image model as such in modelMap", () => {
    for (const hubId of IMAGE_TO_IMAGE) {
      expect(mappingTask(modelMap[hubId]), `${hubId} must be declared image-to-image`).toBe("image-to-image");
    }
  });

  it("declares text-to-image as the default for the remaining image models", () => {
    for (const [hubId, value] of Object.entries(modelMap)) {
      if (IMAGE_TO_IMAGE.includes(hubId)) continue;
      expect(mappingTask(value), `${hubId} should default to text-to-image`).toBe("text-to-image");
    }
  });

  it("sends the source image as inputs and the prompt under parameters", async () => {
    const body = await imageAdapter.buildBody("Qwen/Qwen-Image-Edit", {
      prompt: "make it snow",
      image: "data:image/png;base64,AAAA",
    });

    expect(body.inputs).toBe("AAAA");
    expect(body.parameters).toEqual({ prompt: "make it snow" });
  });

  it("accepts a source image given as a bare base64 payload", async () => {
    const body = await imageAdapter.buildBody("black-forest-labs/FLUX.2-dev", {
      prompt: "winter",
      image: "AAAA",
    });

    expect(body.inputs).toBe("AAAA");
  });

  it("accepts a source image given as an array", async () => {
    const body = await imageAdapter.buildBody("Qwen/Qwen-Image-Edit-2509", {
      prompt: "winter",
      images: ["data:image/png;base64,BBBB"],
    });

    expect(body.inputs).toBe("BBBB");
  });

  it("throws a descriptive error when an image-to-image model gets no source image", async () => {
    await expect(
      imageAdapter.buildBody("black-forest-labs/FLUX.1-Kontext-dev", { prompt: "winter" })
    ).rejects.toThrow(/requires a source image/i);
  });

  it("keeps the text-to-image shape prompt-only", async () => {
    const body = await imageAdapter.buildBody("black-forest-labs/FLUX.1-schnell", {
      prompt: "a lighthouse",
      image: "data:image/png;base64,AAAA",
    });

    expect(body).toEqual({ inputs: "a lighthouse" });
  });

  it("still throws for a model with no router mapping", () => {
    expect(() => imageAdapter.buildUrl("some-org/unknown")).toThrow(/no HuggingFace router mapping/i);
  });
});

// The dashboard's GenericExampleCard only renders the source-image field when the
// selected model declares capabilities: ["edit"] (GenericExampleCard.js:47), and it
// then sends the value as `image`. Without the flag the edit models are unusable
// from the UI even though the adapter supports them.
describe("HuggingFace edit models reach the dashboard", () => {
  const IMAGE_TO_IMAGE = ["black-forest-labs/FLUX.2-dev", "Qwen/Qwen-Image-Edit"];

  it("declares the edit capability on image-to-image models", () => {
    const modelsById = Object.fromEntries(huggingface.models.map((m) => [m.id, m]));

    for (const hubId of IMAGE_TO_IMAGE) {
      expect(modelsById[hubId]?.capabilities, `${hubId} must declare the edit capability`).toContain("edit");
    }
  });

  it("keeps the capability on text-to-image models that do not take a source image", () => {
    const modelsById = Object.fromEntries(huggingface.models.map((m) => [m.id, m]));

    expect(modelsById["black-forest-labs/FLUX.1-schnell"]?.capabilities || []).not.toContain("edit");
  });
});

describe("HuggingFace registry prototype safety", () => {
  it("does not resolve inherited object keys as models", () => {
    // A plain-object map returns a truthy inherited value for these, which would
    // build a URL like `<base>/function Object() { [native code] }`.
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => imageAdapter.buildUrl(key)).toThrow(/no HuggingFace router mapping/i);
    }
  });
});

describe("HuggingFace STT model parameters", () => {
  const sttModels = huggingface.models.filter((m) => m.kind === "stt");

  it("does not advertise a language parameter the ASR route cannot carry", () => {
    // transcribeHuggingFace posts raw audio bytes and never reads formData, and the
    // router's ASR payload has no `language` field — so a UI-declared "language"
    // param is silently dropped. Declaring it lies to the dashboard.
    for (const model of sttModels) {
      expect(model.params, `${model.id} advertises an unusable language param`).toEqual([]);
    }
  });
});

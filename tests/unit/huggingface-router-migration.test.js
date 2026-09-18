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
    for (const [hubId, target] of Object.entries(modelMap)) {
      const provider = String(target).split("/")[0];
      expect(ROUTABLE_PROVIDERS.has(provider), `${hubId} -> unsupported provider ${provider}`).toBe(true);
    }
  });

  it("every modelMap entry has a provider/model path shape", () => {
    for (const [hubId, target] of Object.entries(modelMap)) {
      expect(String(target), `${hubId} has a malformed target`).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._/-]+$/);
    }
  });

  it("does not advertise whisper-small, which has no live provider", () => {
    expect(modelsById["openai/whisper-small"]).toBeUndefined();
  });

  it("advertises whisper-large-v3-turbo as its STT replacement", () => {
    expect(modelsById["openai/whisper-large-v3-turbo"]?.kind).toBe("stt");
  });

  it("exposes the FLUX family image models", () => {
    expect(modelsById["black-forest-labs/FLUX.1-dev"]?.kind).toBe("image");
    expect(modelsById["black-forest-labs/FLUX.2-dev"]?.kind).toBe("image");
  });

  it("exposes Qwen-Image models", () => {
    expect(modelsById["Qwen/Qwen-Image"]?.kind).toBe("image");
    expect(modelsById["Qwen/Qwen-Image-Edit"]?.kind).toBe("image");
  });

  it("exposes Stable Diffusion 3.5 Large", () => {
    expect(modelsById["stabilityai/stable-diffusion-3.5-large"]?.kind).toBe("image");
  });

  it("keeps STT models free of image-only router mappings", () => {
    for (const model of sttModels) {
      expect(modelMap[model.id], `STT model ${model.id} should not be in the image model map`).toBeUndefined();
    }
  });
});

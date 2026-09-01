import REGISTRY from "open-sse/providers/registry/index.js";
import {
  getCapabilitiesForModel,
} from "open-sse/providers/capabilities.js";
import {
  getProviderModels,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";

const CAPABILITY_KEYS = Object.freeze([
  "normal",
  "thinking",
  "code",
  "vision",
  "image",
  "video",
]);

const ALIASES = Object.freeze({
  thinking: [
    "thinking",
    "reasoning",
    "supportsThinking",
    "supportsReasoning",
  ],
  code: [
    "code",
    "coding",
    "supportsCode",
    "codeGeneration",
  ],
  vision: [
    "vision",
    "supportsVision",
    "multimodal",
    "imageInput",
  ],
  image: [
    "image",
    "imageGeneration",
    "supportsImageGeneration",
  ],
  video: [
    "video",
    "videoGeneration",
    "supportsVideoGeneration",
  ],
});

function registryEntries() {
  if (Array.isArray(REGISTRY)) {
    return REGISTRY;
  }

  if (
    REGISTRY &&
    Array.isArray(REGISTRY.providers)
  ) {
    return REGISTRY.providers;
  }

  if (
    REGISTRY &&
    typeof REGISTRY === "object"
  ) {
    return Object.entries(REGISTRY)
      .filter(([, value]) => {
        return value && typeof value === "object";
      })
      .map(([key, value]) => ({
        ...value,
        id: value.id || key,
      }));
  }

  return [];
}

function findProvider(providerId) {
  return registryEntries().find((entry) => {
    return (
      entry?.id === providerId ||
      entry?.provider === providerId ||
      entry?.key === providerId
    );
  }) || null;
}

function findModel(providerId, modelId) {
  const alias =
    PROVIDER_ID_TO_ALIAS?.[providerId] ||
    providerId;

  const candidates = [
    ...(getProviderModels(alias) || []),
    ...(alias === providerId
      ? []
      : (getProviderModels(providerId) || [])),
  ];

  return candidates.find((model) => {
    const id =
      typeof model === "string"
        ? model
        : model?.id || model?.model;

    return id === modelId;
  }) || null;
}

function stringTags(obj) {
  if (!obj || typeof obj !== "object") {
    return new Set();
  }

  const tags = [];

  for (const key of [
    "capabilities",
    "features",
    "supportedCapabilities",
    "modalities",
    "supportedModalities",
  ]) {
    const value = obj[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          tags.push(item.toLowerCase());
        }
      }
    }

    if (typeof value === "string") {
      tags.push(value.toLowerCase());
    }
  }

  return new Set(tags);
}

function explicitBoolean(obj, names) {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }

  for (const name of names) {
    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        name,
      ) &&
      typeof obj[name] === "boolean"
    ) {
      return obj[name];
    }
  }

  const tags = stringTags(obj);

  for (const name of names) {
    const normalized =
      String(name).toLowerCase();

    if (tags.has(normalized)) {
      return true;
    }
  }

  return undefined;
}

function resolveCapability(
  sources,
  names,
  fallback,
) {
  for (const source of sources) {
    const value =
      explicitBoolean(source, names);

    if (value !== undefined) {
      return value;
    }
  }

  return Boolean(fallback);
}

function descriptor(
  providerId,
  modelId,
  model,
) {
  return [
    providerId,
    modelId,
    typeof model === "string"
      ? model
      : model?.name,
    typeof model === "object"
      ? model?.type
      : null,
    typeof model === "object"
      ? model?.kind
      : null,
    typeof model === "object"
      ? model?.category
      : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function classifyModelCapabilities(
  providerId,
  modelId,
  explicitModel = null,
) {
  const provider =
    findProvider(providerId);

  const model =
    explicitModel ||
    findModel(providerId, modelId);

  let native = {};

  try {
    native =
      getCapabilitiesForModel(
        providerId,
        modelId,
      ) || {};
  } catch {
    native = {};
  }

  const sources = [
    model,
    native,
    provider,
  ];

  const text = descriptor(
    providerId,
    modelId,
    model,
  );

  const video = resolveCapability(
    sources,
    ALIASES.video,
    (
      providerId === "veoaifree-web" ||
      /\b(video|veo(?:2|3)?|sora)\b/i.test(text)
    ),
  );

  const image = resolveCapability(
    sources,
    ALIASES.image,
    (
      !video &&
      /\b(image|imagen|flux|dall[- ]?e|stable diffusion)\b/i.test(text)
    ),
  );

  const vision = resolveCapability(
    sources,
    ALIASES.vision,
    /\b(vision|multimodal|omni|vlm?|image[- ]?input)\b/i.test(text),
  );

  const thinking = resolveCapability(
    sources,
    ALIASES.thinking,
    /\b(thinking|reasoning|reasoner|deepseek[- ]?r1|o1|o3|o4)\b/i.test(text),
  );

  const code = resolveCapability(
    sources,
    ALIASES.code,
    /\b(code|coder|coding|codex|devstral)\b/i.test(text),
  );

  const nonChat =
    /\b(embedding|rerank|re[- ]?rank|tts|speech|transcri|audio|search)\b/i
      .test(text);

  const normal =
    providerId !== "veoaifree-web" &&
    !image &&
    !video &&
    !nonChat;

  return {
    normal: Boolean(normal),
    thinking: Boolean(thinking),
    code: Boolean(code),
    vision: Boolean(vision),
    image: Boolean(image),
    video: Boolean(video),
  };
}

export function isCapabilityShape(value) {
  return (
    value &&
    typeof value === "object" &&
    CAPABILITY_KEYS.every(
      (key) => typeof value[key] === "boolean",
    )
  );
}

export {
  CAPABILITY_KEYS,
};

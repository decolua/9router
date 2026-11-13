export const OPENROUTER_QUANTIZATIONS = [
  "int4", "int8", "fp4", "mxfp4", "nvfp4", "fp6", "fp8", "mxfp8",
  "fp16", "bf16", "fp32", "unknown",
];

export const OPENROUTER_PRECISION_PRESETS = {
  unrestricted: [],
  eightBit: ["int8", "fp8", "fp16", "bf16", "fp32"],
  sixteenBit: ["fp16", "bf16", "fp32"],
};

export const OPENROUTER_QUANTIZATION_FAMILIES = {
  fp4: ["fp4", "mxfp4", "nvfp4"],
  fp8: ["fp8", "mxfp8"],
};

// Proprietary families whose serving precision is not published. Match models,
// not entire vendors: GPT-OSS and Gemma must still obey the precision policy.
// ponytail: explicit families only; extend when another family is verified.
export const OPENROUTER_UNDISCLOSED_PRECISION_MODELS = [
  /^anthropic\/claude(?:-|$)/,
  /^openai\/(?:gpt-(?!oss(?:-|:|$))|chatgpt-|o[1-9](?:-|:|$)|text-embedding-)/,
  /^google\/gemini-/,
  /^x-ai\/grok-(?:[3-9](?:[.:-]|$)|build-)/,
];

export const OPENROUTER_ROUTING_ENDPOINTS = {
  completion: { precision: true, zdr: true },
  embedding: { precision: true, zdr: true },
  systemone: { precision: true, zdr: true },
  image: { exception: "allowImageWithoutZdr", reason: "ZDR enforcement for dedicated image generation is not verified" },
  video: { exception: "allowVideoWithoutZdr", reason: "OpenRouter video generation is not eligible for ZDR" },
};

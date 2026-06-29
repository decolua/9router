"use client";

export function Row({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-full text-xs font-medium text-text-muted sm:w-20 sm:shrink-0">{label}</span>
      <div className="w-full min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const KIND_EXAMPLE_CONFIG = {
  webSearch: {
    inputLabel: "Query",
    inputPlaceholder: "What is the latest news about AI?",
    defaultInput: "What is the latest news about AI?",
    bodyKey: "query",
    defaultResponse: `{\n  "results": [\n    { "title": "...", "url": "...", "snippet": "..." }\n  ]\n}`,
    extraFields: [
      { key: "search_type", label: "Type", type: "select", default: "web", options: ["web", "news"] },
      { key: "max_results", label: "Max results", type: "number", default: 5, min: 1, max: 100 },
      { key: "country", label: "Country", type: "text", default: "" },
      { key: "language", label: "Language", type: "text", default: "" },
    ],
  },
  webFetch: {
    inputLabel: "URL",
    inputPlaceholder: "https://example.com",
    defaultInput: "https://example.com",
    bodyKey: "url",
    defaultResponse: `{\n  "content": "...",\n  "title": "...",\n  "url": "..."\n}`,
    extraFields: [
      { key: "format", label: "Format", type: "select", default: "markdown", options: ["markdown", "text", "html"] },
      { key: "max_characters", label: "Max chars", type: "number", default: 0, min: 0 },
    ],
  },
  image: {
    inputLabel: "Prompt",
    inputPlaceholder: "A cute cat wearing a hat",
    defaultInput: "A cute cat wearing a hat",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "b64_json": "..." }\n  ]\n}`,
    extraFields: [
      { key: "n", label: "n", type: "number", default: 1, min: 1, max: 4 },
      { key: "size", label: "Size", type: "select", default: "auto", options: ["auto", "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"] },
      { key: "quality", label: "Quality", type: "select", default: "auto", options: ["auto", "low", "medium", "high", "standard", "hd"] },
      { key: "background", label: "Background", type: "select", default: "auto", options: ["auto", "transparent", "opaque"] },
      { key: "style", label: "Style", type: "select", default: "", options: ["", "vivid", "natural"] },
      { key: "response_format", label: "Format", type: "select", default: "", options: ["", "url", "b64_json"] },
      { key: "image_detail", label: "Image Detail", type: "select", default: "high", options: ["auto", "low", "high", "original"] },
      { key: "output_format", label: "Codec", type: "select", default: "png", options: ["png", "jpeg", "webp"] },
    ],
  },
  imageToText: {
    inputLabel: "Image URL",
    inputPlaceholder: "https://example.com/image.png",
    defaultInput: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg",
    bodyKey: "url",
    extraBody: { prompt: "Describe this image in detail" },
    defaultResponse: `{\n  "text": "A cat sitting on a windowsill...",\n  "model": "..."\n}`,
  },
  video: {
    inputLabel: "Prompt",
    inputPlaceholder: "A serene lake at sunset",
    defaultInput: "A serene lake at sunset",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "..." }\n  ]\n}`,
  },
  music: {
    inputLabel: "Prompt",
    inputPlaceholder: "A calm piano melody",
    defaultInput: "A calm piano melody",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "format": "mp3" }\n  ]\n}`,
  },
};

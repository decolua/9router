const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_STOP_SEQUENCES = 4;
const MAX_STOP_SEQUENCE_LENGTH = 256;

function nonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonDefault(value, defaultValue) {
  return validNumber(value) && value !== defaultValue;
}

function normalizeStops(stops) {
  if (stops == null || stops === "") return [];
  const values = Array.isArray(stops) ? stops : [stops];
  if (values.length > MAX_STOP_SEQUENCES) {
    throw new RangeError("A request supports at most four stop sequences.");
  }

  return values.map((stop) => {
    const value = nonEmptyString(stop);
    if (!value) throw new TypeError("Stop sequences must be non-empty strings.");
    if (value.length > MAX_STOP_SEQUENCE_LENGTH) {
      throw new RangeError(`Each stop sequence must be at most ${MAX_STOP_SEQUENCE_LENGTH} characters.`);
    }
    return value;
  });
}

function normalizeImages(images) {
  const values = Array.isArray(images) ? images : [];
  if (values.length > MAX_IMAGES) {
    throw new RangeError("A request supports at most four images; a fifth image is not allowed.");
  }

  return values.map((image) => {
    if (!image || typeof image !== "object" || !nonEmptyString(image.dataUrl)) {
      throw new TypeError("Each image must contain a data URL.");
    }
    if (!validNumber(image.size) || image.size < 0 || image.size > MAX_IMAGE_BYTES) {
      throw new RangeError("Each image must be at most two MiB.");
    }
    return image.dataUrl;
  });
}

function userMessage(content, imageUrls) {
  const text = nonEmptyString(content);
  if (imageUrls.length === 0) return { role: "user", content: text };

  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const url of imageUrls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return { role: "user", content: parts };
}

function normalizeMessages(messages, images) {
  const source = Array.isArray(messages) ? messages : [];
  return source
    .filter((message) => message?.role && message.role !== "system")
    .map((message, index) => (
      message.role === "user" && index === source.length - 1
        ? userMessage(message.content, images)
        : { role: message.role, content: message.content }
    ));
}

function addSupportedControls(body, controls, capabilities) {
  if (capabilities.temperature && isNonDefault(controls.temperature, 1)) body.temperature = controls.temperature;
  if (capabilities.topP && isNonDefault(controls.topP, 1)) body.top_p = controls.topP;
  if (capabilities.maxTokens && validNumber(controls.maxTokens) && controls.maxTokens > 0) body.max_tokens = controls.maxTokens;
  if (capabilities.presencePenalty && isNonDefault(controls.presencePenalty, 0)) body.presence_penalty = controls.presencePenalty;
  if (capabilities.frequencyPenalty && isNonDefault(controls.frequencyPenalty, 0)) body.frequency_penalty = controls.frequencyPenalty;
  if (capabilities.seed && validNumber(controls.seed)) body.seed = controls.seed;

  const stops = normalizeStops(controls.stop);
  if (capabilities.stop && stops.length > 0) body.stop = stops;

  const reasoning = controls.reasoning;
  if (capabilities.reasoning && reasoning && typeof reasoning === "object" && nonEmptyString(reasoning.effort)) {
    body.reasoning_effort = reasoning.effort.trim();
  }
}

export function buildPlaygroundRequest(input) {
  const model = input?.model;
  const modelId = nonEmptyString(model?.id);
  if (!modelId) throw new TypeError("A selected model is required.");

  const capabilities = model.capabilities && typeof model.capabilities === "object" ? model.capabilities : {};
  const images = normalizeImages(input?.images);
  const body = {
    model: modelId,
    messages: [],
    stream: true,
  };
  const systemPrompt = nonEmptyString(input?.systemPrompt);
  if (systemPrompt) body.messages.push({ role: "system", content: systemPrompt });
  body.messages.push(...normalizeMessages(input?.messages, capabilities.images ? images : []));
  addSupportedControls(body, input?.controls && typeof input.controls === "object" ? input.controls : {}, capabilities);
  return body;
}

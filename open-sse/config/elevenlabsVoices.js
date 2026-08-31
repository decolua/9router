// ElevenLabs default ("premade") voice roster — used as a fallback when the
// configured API key cannot list voices via GET /v1/voices.
//
// Why this exists: restricted API keys (the recommended way to scope keys) can
// grant `text_to_speech` WITHOUT `voices_read`. In that case /v1/voices returns
// 401 missing_permissions and the voice picker would otherwise be empty, making
// the whole ElevenLabs integration appear broken even though synthesis works.
//
// Shape mirrors the /v1/voices items (voice_id, name, category, labels) so the
// same normalization logic in the routes can consume both sources. `free`
// reflects whether the default-plan account can synthesize the voice via API
// (verified against the live API — some "default" voices now require a paid plan).

// Voice used when a request names no voice at all (Adam — dominant, firm; free
// on the default plan). Exported so the adapter and the dashboard's
// TTS_PROVIDER_CONFIG preselect the same one — otherwise the panel's curl
// snippet would not reproduce what the server actually synthesizes.
export const ELEVENLABS_DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

export const ELEVENLABS_DEFAULT_VOICES = [
  { voice_id: "9BWtsMINqrJLrRacOk9x", name: "Aria",      free: false, labels: { gender: "female", accent: "american",      language: "en" } },
  { voice_id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger",     free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",     free: true,  labels: { gender: "female", accent: "american",      language: "en" } },
  { voice_id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura",     free: true,  labels: { gender: "female", accent: "american",      language: "en" } },
  { voice_id: "IKne3meq5aSn9XLyUdCD", name: "Charlie",   free: true,  labels: { gender: "male",   accent: "australian",    language: "en" } },
  { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George",    free: true,  labels: { gender: "male",   accent: "british",       language: "en" } },
  { voice_id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum",    free: true,  labels: { gender: "male",   accent: "transatlantic", language: "en" } },
  { voice_id: "SAz9YHcvj6GT2YYXdXww", name: "River",     free: true,  labels: { gender: "neutral", accent: "american",     language: "en" } },
  { voice_id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam",      free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", free: false, labels: { gender: "female", accent: "swedish",       language: "en" } },
  { voice_id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice",     free: true,  labels: { gender: "female", accent: "british",       language: "en" } },
  { voice_id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda",   free: true,  labels: { gender: "female", accent: "american",      language: "en" } },
  { voice_id: "bIHbv24MWmeRgasZH58o", name: "Will",      free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica",   free: true,  labels: { gender: "female", accent: "american",      language: "en" } },
  { voice_id: "cjVigY5qzO86Huf0OWal", name: "Eric",      free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "iP95p4xoKVk53GoZ742B", name: "Chris",     free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian",     free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
  { voice_id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",    free: true,  labels: { gender: "male",   accent: "british",       language: "en" } },
  { voice_id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",      free: true,  labels: { gender: "female", accent: "british",       language: "en" } },
  { voice_id: "pqHfZKP75CvOlQylNhV4", name: "Bill",      free: true,  labels: { gender: "male",   accent: "american",      language: "en" } },
].map((v) => ({ ...v, category: "premade", lang: v.labels.language, free_users_allowed: v.free }));

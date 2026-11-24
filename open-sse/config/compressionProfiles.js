// Overlay on read: selecting Custom restores the administrator's manual values.
const base = { headroomEnabled: false, headroomCompressUserMessages: false,
  headroomTimeoutMs: 3000, rtkEnabled: false, pxpipeEnabled: false };
export const COMPRESSION_PROFILES = {
  off: base,
  chat: { ...base, headroomEnabled: true, headroomCompressUserMessages: true },
  agent: { ...base, headroomEnabled: true, rtkEnabled: true },
  dev: { ...base, headroomEnabled: true },
};
export function isCompressionProfile(name) {
  return typeof name === "string" && (name === "custom" || Object.hasOwn(COMPRESSION_PROFILES, name));
}

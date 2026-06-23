import type { JsonValue } from "open-sse/types/executor.js";

// parseJson: boundary between raw SQLite TEXT and typed values.
// The `unknown` input is exactly the parse boundary; callers that know
// the shape pass a typed fallback or call the generic overload.
export function parseJson<T>(str: string | null | undefined, fallback: T): T;
export function parseJson(str: string | null | undefined, fallback?: null): JsonValue | null;
export function parseJson<T>(str: string | null | undefined, fallback?: T | null): JsonValue | T | null {
  if (str == null) return fallback ?? null;
  if (typeof str !== "string") return str as unknown as JsonValue;
  try { return JSON.parse(str) as JsonValue; } catch { return fallback ?? null; }
}

export function stringifyJson(value: JsonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

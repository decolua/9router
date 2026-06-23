// open-sse/types/ids.ts
// Branded nominal types for string IDs — prevent cross-wiring at compile time
// with zero runtime overhead. The brand is a phantom property erased by TS;
// the intersection with `string` means values are structurally still strings.

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type ProviderId = string & { readonly __brand: "ProviderId" };
export type InstanceId  = string & { readonly __brand: "InstanceId"  };
export type ModelId     = string & { readonly __brand: "ModelId"     };
export type SessionId   = string & { readonly __brand: "SessionId"   };

// ---------------------------------------------------------------------------
// Smart constructors (compile-time cast, no runtime overhead)
// ---------------------------------------------------------------------------

/** Assert that `s` is a valid ProviderId. Cast is safe: all ProviderId are strings. */
export function asProviderId(s: string): ProviderId {
  return s as ProviderId;
}

/** Assert that `s` is a valid InstanceId. */
export function asInstanceId(s: string): InstanceId {
  return s as InstanceId;
}

/** Assert that `s` is a valid ModelId. */
export function asModelId(s: string): ModelId {
  return s as ModelId;
}

/** Assert that `s` is a valid SessionId. */
export function asSessionId(s: string): SessionId {
  return s as SessionId;
}

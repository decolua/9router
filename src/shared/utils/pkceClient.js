/**
 * PKCE helpers for browser (SPA). Uses Web Crypto.
 */

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier() {
  const array = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < 32; i++) array[i] = Math.floor(Math.random() * 256);
  }
  return base64UrlEncode(array);
}

export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

export function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

const SESSION_KEY_VERIFIER = "oauth_code_verifier";
const SESSION_KEY_STATE = "oauth_state";

export function savePkceToSession(verifier, state) {
  try {
    sessionStorage.setItem(SESSION_KEY_VERIFIER, verifier);
    sessionStorage.setItem(SESSION_KEY_STATE, state);
  } catch (e) {
    console.warn("sessionStorage not available", e);
  }
}

export function getPkceFromSession() {
  try {
    const verifier = sessionStorage.getItem(SESSION_KEY_VERIFIER);
    const state = sessionStorage.getItem(SESSION_KEY_STATE);
    sessionStorage.removeItem(SESSION_KEY_VERIFIER);
    sessionStorage.removeItem(SESSION_KEY_STATE);
    return { verifier, state };
  } catch (e) {
    return { verifier: null, state: null };
  }
}

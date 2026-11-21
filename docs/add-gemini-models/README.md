**Date:** 2026-10-28
**Feature:** Addition of Gemini 3.1 Flash Lite and Gemini Embedding 2 Models

# Gemini Model Expansion Proposal: Registering Stable Gemini 3.1 Flash Lite and Multimodal Gemini Embedding 2

This proposal expands the built-in Gemini catalog in 9Router to include the stable release of Google's lightweight reasoning model `gemini-3.1-flash-lite` and the stable multimodal embedding model `gemini-embedding-2`, aligning with official Google AI Studio releases (`https://aistudio.google.com/docs/models/gemini-3.1-flash-lite` and `https://aistudio.google.com/docs/models/gemini-embedding-2`).

With these additions, users can route and test both text/reasoning chat workloads and multimodal vector embeddings directly through the Gemini provider interface on 9Router.

## 1. The Problem
1. **Missing Stable IDs in Registry:** Previously, 9Router's Gemini registry (`open-sse/providers/registry/gemini.js`) only contained the preview variants `gemini-3.1-flash-lite-preview` and `gemini-embedding-2-preview`. Users attempting to target the stable model names `gemini-3.1-flash-lite` and `gemini-embedding-2` per Google AI Studio documentation could not find them in the Available Models list.
2. **Quota and Status Divergence on High Demand Models:** Certain preview models (e.g., `gemini-3.8-flash` and `gemini-3.7-flash`) frequently experience high upstream queue demand and strict Free Tier request limits (20 requests/day), causing timeout or failover cascades. Exposing the stable, fast `gemini-3.1-flash-lite` gives users a responsive, highly available alternative.

## 2. The Solution
1. **Register `gemini-3.1-flash-lite`:** Add `{ id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" }` to `open-sse/providers/registry/gemini.js` and record pricing in `open-sse/providers/pricing.js`.
2. **Register `gemini-embedding-2`:** Add `{ id: "gemini-embedding-2", name: "Gemini Embedding 2", kind: "embedding" }` alongside the existing preview entry in `open-sse/providers/registry/gemini.js`.
3. **Verify Compatibility with Existing Stable Models:** Ensure `gemini-3-flash-preview`, `gemini-2.5-flash`, and `gemini-2.5-pro` remain properly mapped and operational.

---

## 3. General Implementation Guide

### Files Modified:
- `open-sse/providers/registry/gemini.js`:
  - Added `gemini-3.1-flash-lite` to the `models` array.
  - Added `gemini-embedding-2` (`kind: "embedding"`) to the `models` array.
- `open-sse/providers/pricing.js`:
  - Added `"google/gemini-3.1-flash-lite"` with input, output, cached, and reasoning rates.

---

## 4. Conclusion
The Gemini provider registry now exposes stable `gemini-3.1-flash-lite` and `gemini-embedding-2` models, allowing users to leverage high-throughput, low-latency reasoning and vector embeddings through 9Router.

**Last Updated:** 2026-10-28

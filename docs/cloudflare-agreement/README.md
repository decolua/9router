**Date:** 2026-06-18
**Feature:** Cloudflare One-Click Model Agreement

# Cloudflare One-Click Model Agreement Proposal: UI Integration

This document explains the architecture behind the Cloudflare One-Click Model Agreement feature and how it seamlessly handles Cloudflare's Terms of Service requirement directly from the UI.

## 1. The Problem
Meta's Llama 3.2 Vision model is hosted by Cloudflare Workers AI. Cloudflare requires every user (each Cloudflare Account ID) to explicitly agree to Meta's *Terms of Service* (ToS) before this model can be used, otherwise it returns an HTTP 403 error `Model Agreement`.

## 2. The Solution
To improve User Experience, 9router has been equipped with a smart ToS agreement feature. When a user tests the connection or adds an API key, the system intercepts the 403 error and displays a dynamic "Agree to Terms & Conditions" button, allowing users to accept the agreement seamlessly in the background without needing to access the CLI / terminal.

---

## 3. General Implementation Guide

If you wish to adopt this feature officially, you will need the following implementation pieces:

### A. Smart Error Detection & Specific Trigger
When a user performs *Add API Key* or tests the connection (*Test Connection*), the endpoints `/api/providers/validate/route.js` and `testUtils.js` no longer treat `403` as a pure validation failure. The API will parse the JSON Error returned by Cloudflare. If the error contains `"Model Agreement"`, a special status `MODEL_AGREEMENT_REQUIRED` will be returned to the frontend.

### B. Responsive UI Integration (`AddApiKeyModal.js` & `page.js`)
The dashboard components will detect this status and dynamically display an **"Agree to Terms & Conditions"** button. For already registered providers, if a user clicks the Test (🧪) icon on restricted models, a smart yellow warning box will appear in the header section along with the agreement button. The same logic applies to the **"Add Custom Model"** modal window.

### C. The Background Agreement Endpoint (`/api/providers/cloudflare-agree/route.js`)
When clicked, the agreement button hits the new endpoint by sending a JSON payload `{ prompt: "agree" }` using the active connection credentials. If accepted, the API connection is automatically validated as successful.

### D. Smart Cooldown Lock Clearance
To prevent users from waiting for the penalty time to expire after agreeing, the agreement endpoint is equipped with clearance logic. Immediately after Cloudflare returns a success response, 9router will proactively remove the `lastError` parameter, clear `errorCode`, and destroy all `modelLock_...` history on that connection.

### E. Internationalization (i18n) Support
All warning texts, ToS agreement buttons, and UI notifications have been integrated with the 9router language system (`@/i18n/runtime`), ensuring consistent support when users change languages.

---

## 4. Conclusion
By intercepting Cloudflare's specific 403 `Model Agreement` error and providing a one-click UI solution with automatic cooldown clearance, we achieve a frictionless user experience for interacting with restricted models like Meta's Llama 3.2 Vision.

**Last Updated:** 2026-06-23

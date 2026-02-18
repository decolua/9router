import { initTranslators } from "open-sse/translator/index.js";
import { ollamaModels } from "open-sse/config/ollamaModels.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import * as log from "./utils/logger.js";

// Static imports for handlers (avoid dynamic import CPU cost)
import { handleCleanup } from "./handlers/cleanup.js";
import { handleCacheClear } from "./handlers/cache.js";
import { handleSync } from "./handlers/sync.js";
import { handleChat } from "./handlers/chat.js";
import { handleVerify } from "./handlers/verify.js";
import { handleTestClaude } from "./handlers/testClaude.js";
import { handleForward } from "./handlers/forward.js";
import { handleForwardRaw } from "./handlers/forwardRaw.js";
import { handleEmbeddings } from "./handlers/embeddings.js";
import { createLandingPageResponse } from "./services/landingPage.js";

// Initialize translators at module load (static imports)
initTranslators();

// Helper to add CORS headers to response
function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

const worker = {
  async scheduled(event, env, ctx) {
    const result = await handleCleanup(env);
    log.info("SCHEDULED", "Cleanup completed", result);
  },

  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    let path = url.pathname;

    // Normalize /v1/v1/* → /v1/*
    if (path.startsWith("/v1/v1/")) {
      path = path.replace("/v1/v1/", "/v1/");
    } else if (path === "/v1/v1") {
      path = "/v1";
    }

    log.request(request.method, path);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    try {
      // Routes
      
      // Landing page
      if (path === "/" && request.method === "GET") {
        const response = createLandingPageResponse();
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      if (path === "/health" && request.method === "GET") {
        log.response(200, Date.now() - startTime);
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Ollama compatible - list models
      if (path === "/api/tags" && request.method === "GET") {
        log.response(200, Date.now() - startTime);
        return new Response(JSON.stringify(ollamaModels), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (path === "/cache/clear" && request.method === "POST") {
        const response = await handleCacheClear(request, env);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Sync provider data by machineId (GET, POST, DELETE)
      if (path.startsWith("/sync/") && ["GET", "POST", "DELETE"].includes(request.method)) {
        const response = await handleSync(request, env, ctx);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // ========== NEW FORMAT: /v1/... (machineId in API key) ==========
      
      // New format: /v1/chat/completions
      if (path === "/v1/chat/completions" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return addCorsHeaders(response);
      }

      // New format: /v1/messages (Claude format)
      if (path === "/v1/messages" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return addCorsHeaders(response);
      }

      // New format: /v1/embeddings
      if (path === "/v1/embeddings" && request.method === "POST") {
        const response = await handleEmbeddings(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return addCorsHeaders(response);
      }

      // New format: /v1/responses (OpenAI Responses API - Codex CLI)
      if (path === "/v1/responses" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // New format: /v1/verify
      if (path === "/v1/verify" && request.method === "GET") {
        const response = await handleVerify(request, env, null);
        log.response(response.status, Date.now() - startTime);
        return addCorsHeaders(response);
      }

      // New format: /v1/api/chat (Ollama format)
      if (path === "/v1/api/chat" && request.method === "POST") {
        const clonedReq = request.clone();
        const body = await clonedReq.json();
        const response = await handleChat(request, env, ctx, null);
        const ollamaResponse = transformToOllama(response, body.model || "llama3.2");
        log.response(200, Date.now() - startTime);
        return ollamaResponse;
      }

      // ========== OLD FORMAT: /{machineId}/v1/... ==========

      // Machine ID based chat endpoint
      if (path.match(/^\/[^\/]+\/v1\/chat\/completions$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleChat(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Machine ID based embeddings endpoint
      if (path.match(/^\/[^\/]+\/v1\/embeddings$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleEmbeddings(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return addCorsHeaders(response);
      }

      // Machine ID based messages endpoint (Claude format)
      if (path.match(/^\/[^\/]+\/v1\/messages$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleChat(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Machine ID based api/chat endpoint (Ollama format)
      if (path.match(/^\/[^\/]+\/v1\/api\/chat$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const clonedReq = request.clone();
        const body = await clonedReq.json();
        const response = await handleChat(request, env, ctx, machineId);
        const ollamaResponse = transformToOllama(response, body.model || "llama3.2");
        log.response(200, Date.now() - startTime);
        return ollamaResponse;
      }

      // Machine ID based verify endpoint
      if (path.match(/^\/[^\/]+\/v1\/verify$/) && request.method === "GET") {
        const machineId = path.split("/")[1];
        const response = await handleVerify(request, env, machineId);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Test Claude - forward to Anthropic API
      if (path === "/testClaude" && request.method === "POST") {
        const response = await handleTestClaude(request);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Forward request to any endpoint
      if (path === "/forward" && request.method === "POST") {
        const response = await handleForward(request);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Forward request via raw TCP socket (bypasses CF auto headers)
      if (path === "/forward-raw" && request.method === "POST") {
        const response = await handleForwardRaw(request);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      log.warn("ROUTER", "Not found", { path });
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      log.error("ROUTER", error.message, { stack: error.stack });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

export default worker;


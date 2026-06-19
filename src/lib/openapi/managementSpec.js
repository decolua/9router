// OpenAPI 3.1 spec for the Management & Control API.
// Served as JSON by /api/v1/admin/openapi.json and consumed by the docs page.
import { getAppVersion } from "@/lib/db/version.js";

const VERSION = getAppVersion();

const ApiKey = {
  type: "object",
  required: ["id", "name", "isActive", "role", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    machineId: { type: "string", nullable: true },
    isActive: { type: "boolean" },
    role: { type: "string", enum: ["admin", "user"] },
    allowedModels: { type: "array", items: { type: "string" } },
    allowedProviders: { type: "array", items: { type: "string" } },
    monthlyTokenLimit: { type: "integer", minimum: 0 },
    monthlyBudgetUsd: { type: "number", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const ApiKeyWithUsage = {
  allOf: [
    { $ref: "#/components/schemas/ApiKey" },
    {
      type: "object",
      properties: {
        usageThisMonth: {
          type: "object",
          nullable: true,
          properties: {
            tokens: { type: "integer" },
            cost: { type: "number" },
            requests: { type: "integer" },
            monthStart: { type: "string", format: "date-time" },
          },
        },
      },
    },
  ],
};

const MonthlyUsage = {
  type: "object",
  properties: {
    tokens: { type: "integer" },
    cost: { type: "number" },
    requests: { type: "integer" },
    monthStart: { type: "string", format: "date-time" },
  },
};

const ProviderInfo = {
  type: "object",
  properties: {
    id: { type: "string" },
    displayName: { type: "string" },
    alias: { type: "string", nullable: true },
    aliases: { type: "array", items: { type: "string" } },
  },
};

const ModelInfo = {
  type: "object",
  properties: {
    id: { type: "string" },
    provider: { type: "string" },
    kind: { type: "string" },
  },
};

const ErrorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

const bearerOrApiKey = [{ bearerAuth: [] }, { apiKeyHeader: [] }];

export const managementSpec = {
  openapi: "3.1.0",
  info: {
    title: "9Router Management & Control API",
    version: VERSION,
    description:
      "Authenticated management surface for 9Router (keys, providers, models, usage). Auth: Bearer or x-api-key with an active apiKeys record; admin role required for write operations.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKeyHeader: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      ApiKey,
      ApiKeyWithUsage,
      MonthlyUsage,
      ProviderInfo,
      ModelInfo,
      Error: ErrorSchema,
      CreateApiKey: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["admin", "user"] },
          allowedModels: { type: "array", items: { type: "string" } },
          allowedProviders: { type: "array", items: { type: "string" } },
          monthlyTokenLimit: { type: "integer", minimum: 0 },
          monthlyBudgetUsd: { type: "number", minimum: 0 },
        },
      },
      UpdateApiKey: {
        type: "object",
        properties: {
          name: { type: "string" },
          isActive: { type: "boolean" },
          role: { type: "string", enum: ["admin", "user"] },
          allowedModels: { type: "array", items: { type: "string" } },
          allowedProviders: { type: "array", items: { type: "string" } },
          monthlyTokenLimit: { type: "integer", minimum: 0 },
          monthlyBudgetUsd: { type: "number", minimum: 0 },
        },
      },
      UsageStats: {
        type: "object",
        description: "Free-form, returned by getUsageStats.",
      },
    },
  },
  security: bearerOrApiKey,
  paths: {
    "/api/v1/admin/me": {
      get: {
        summary: "Get caller's own key record (any role)",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { key: { $ref: "#/components/schemas/ApiKeyWithUsage" } },
                },
              },
            },
          },
          "401": {
            description: "unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/v1/admin/me/usage": {
      get: {
        summary: "Caller's monthly usage (any role)",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    summary: { $ref: "#/components/schemas/MonthlyUsage" },
                    breakdown: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/admin/keys": {
      get: {
        summary: "List all keys (admin)",
        "x-role": "admin",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    keys: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ApiKeyWithUsage" },
                    },
                  },
                },
              },
            },
          },
          "403": {
            description: "admin role required",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      post: {
        summary: "Create a key (admin)",
        "x-role": "admin",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateApiKey" } } },
        },
        responses: {
          "201": {
            description: "created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKey" } } },
          },
        },
      },
    },
    "/api/v1/admin/keys/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: {
        summary: "Get a key (admin)",
        "x-role": "admin",
        responses: {
          "200": { description: "ok" },
          "404": { description: "not found" },
        },
      },
      patch: {
        summary: "Update a key (admin)",
        "x-role": "admin",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateApiKey" } } },
        },
        responses: {
          "200": { description: "ok" },
          "409": { description: "last admin guard" },
        },
      },
      delete: {
        summary: "Delete a key (admin)",
        "x-role": "admin",
        responses: {
          "200": { description: "ok" },
          "409": { description: "last admin guard" },
        },
      },
    },
    "/api/v1/admin/providers": {
      get: {
        summary: "List providers (any role)",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    providers: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ProviderInfo" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/admin/models": {
      get: {
        summary: "List models (any role)",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    models: { type: "array", items: { $ref: "#/components/schemas/ModelInfo" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/admin/usage": {
      get: {
        summary: "System-wide usage stats (admin)",
        "x-role": "admin",
        parameters: [
          {
            name: "period",
            in: "query",
            schema: {
              type: "string",
              enum: ["24h", "today", "7d", "30d", "60d", "all"],
              default: "30d",
            },
          },
        ],
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UsageStats" } } },
          },
        },
      },
    },
  },
};

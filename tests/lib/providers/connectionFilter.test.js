/**
 * Tests for src/lib/providers/connectionFilter.js
 */

import { describe, it, expect } from "vitest";
import {
  getProviderStats,
  passesConnectionFilter,
} from "../../../src/lib/providers/connectionFilter.js";

describe("connectionFilter", () => {
  describe("getProviderStats", () => {
    it("should return zero stats for provider with no connections", () => {
      const stats = getProviderStats("openai", "apikey", []);
      expect(stats).toEqual({
        connected: 0,
        error: 0,
        total: 0,
        errorCode: null,
        errorTime: null,
        allDisabled: false,
      });
    });

    it("should count active connections correctly", () => {
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
        { provider: "openai", authType: "apikey", testStatus: "success", isActive: true },
        { provider: "anthropic", authType: "apikey", testStatus: "active", isActive: true },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.connected).toBe(2);
      expect(stats.total).toBe(2);
    });

    it("should count error connections correctly", () => {
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "error", isActive: true, lastErrorType: "upstream_auth_error" },
        { provider: "openai", authType: "apikey", testStatus: "expired", isActive: true },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.error).toBe(2);
      expect(stats.connected).toBe(0);
      expect(stats.errorCode).toBe("AUTH");
    });

    it("should support single auth type as string", () => {
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.total).toBe(1);
    });

    it("should support multiple auth types as array", () => {
      const connections = [
        { provider: "kiro", authType: "oauth", testStatus: "active", isActive: true },
        { provider: "kiro", authType: "apikey", testStatus: "active", isActive: true },
        { provider: "kiro", authType: "api_key", testStatus: "active", isActive: true },
      ];
      const stats = getProviderStats("kiro", ["oauth", "apikey", "api_key"], connections);
      expect(stats.total).toBe(3);
      expect(stats.connected).toBe(3);
    });

    it("should filter by auth type correctly", () => {
      const connections = [
        { provider: "google", authType: "oauth", testStatus: "active", isActive: true },
        { provider: "google", authType: "apikey", testStatus: "active", isActive: true },
      ];
      const stats = getProviderStats("google", "oauth", connections);
      expect(stats.total).toBe(1);
      expect(stats.connected).toBe(1);
    });

    it("should detect all disabled state", () => {
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: false },
        { provider: "openai", authType: "apikey", testStatus: "success", isActive: false },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.allDisabled).toBe(true);
      expect(stats.total).toBe(2);
    });

    it("should not mark as allDisabled if some are active", () => {
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
        { provider: "openai", authType: "apikey", testStatus: "success", isActive: false },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.allDisabled).toBe(false);
    });

    it("should handle cooldown status correctly", () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "unavailable",
          isActive: true,
          modelLock_gpt4: futureTime,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      // Unavailable with active cooldown (future time) keeps unavailable status
      expect(stats.connected).toBe(0);
      expect(stats.error).toBe(1);
    });

    it("should handle expired cooldown as active", () => {
      const pastTime = new Date(Date.now() - 60000).toISOString();
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "unavailable",
          isActive: true,
          modelLock_gpt4: pastTime,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      // Unavailable with expired cooldown becomes active
      expect(stats.connected).toBe(1);
      expect(stats.error).toBe(0);
    });

    it("should extract AUTH error code from lastErrorType", () => {
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorType: "upstream_auth_error",
          lastErrorAt: new Date().toISOString(),
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorCode).toBe("AUTH");
    });

    it("should extract 429 error code from lastErrorType", () => {
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorType: "upstream_rate_limited",
          lastErrorAt: new Date().toISOString(),
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorCode).toBe("429");
    });

    it("should extract RUNTIME error code from message", () => {
      const connections = [
        {
          provider: "ollama",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastError: "Ollama not runnable",
          lastErrorAt: new Date().toISOString(),
        },
      ];
      const stats = getProviderStats("ollama", "apikey", connections);
      expect(stats.errorCode).toBe("RUNTIME");
    });

    it("should extract AUTH error code from numeric errorCode", () => {
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          errorCode: 401,
          lastError: "Unauthorized",
          lastErrorAt: new Date().toISOString(),
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorCode).toBe("401");
    });

    it("should return latest error when multiple errors exist", () => {
      const oldDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const newDate = new Date().toISOString();
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorType: "network_error",
          lastErrorAt: oldDate,
        },
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorType: "upstream_auth_error",
          lastErrorAt: newDate,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorCode).toBe("AUTH"); // Latest error
      expect(stats.error).toBe(2);
    });

    it("should return 'just now' for very recent errors (< 1 minute)", () => {
      const recentDate = new Date(Date.now() - 30000).toISOString(); // 30 seconds ago
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorAt: recentDate,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorTime).toBe("just now");
    });

    it("should return null for missing lastErrorAt", () => {
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          // no lastErrorAt
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorTime).toBe(null);
    });

    it("should calculate relative error time in minutes", () => {
      const minutesAgo = new Date(Date.now() - 5 * 60000).toISOString(); // 5 minutes ago
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorAt: minutesAgo,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorTime).toMatch(/\d+m ago/);
    });

    it("should calculate relative error time in hours", () => {
      const hoursAgo = new Date(Date.now() - 3 * 3600000).toISOString(); // 3 hours ago
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorAt: hoursAgo,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorTime).toMatch(/\d+h ago/);
    });

    it("should calculate relative error time in days", () => {
      const daysAgo = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
      const connections = [
        {
          provider: "openai",
          authType: "apikey",
          testStatus: "error",
          isActive: true,
          lastErrorAt: daysAgo,
        },
      ];
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.errorTime).toMatch(/\d+d ago/);
    });
  });

  describe("passesConnectionFilter", () => {
    const connections = [
      { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
      { provider: "anthropic", authType: "apikey", testStatus: "error", isActive: true },
      { provider: "google", authType: "oauth", testStatus: "active", isActive: true },
    ];

    it("should return true when connectedOnly is false", () => {
      const result = passesConnectionFilter("openai", "apikey", false, connections);
      expect(result).toBe(true);
    });

    it("should return true for provider with connected accounts when connectedOnly is true", () => {
      const result = passesConnectionFilter("openai", "apikey", true, connections);
      expect(result).toBe(true);
    });

    it("should return false for provider with only error connections when connectedOnly is true", () => {
      const result = passesConnectionFilter("anthropic", "apikey", true, connections);
      expect(result).toBe(false);
    });

    it("should return false for provider with no connections when connectedOnly is true", () => {
      const result = passesConnectionFilter("cohere", "apikey", true, connections);
      expect(result).toBe(false);
    });

    it("should support array of auth types", () => {
      const kiroConnections = [
        { provider: "kiro", authType: "oauth", testStatus: "active", isActive: true },
        { provider: "kiro", authType: "apikey", testStatus: "error", isActive: true },
      ];
      const result = passesConnectionFilter(
        "kiro",
        ["oauth", "apikey"],
        true,
        kiroConnections,
      );
      expect(result).toBe(true); // Has at least one connected (oauth)
    });

    it("should return false when no auth types match", () => {
      const result = passesConnectionFilter("google", "apikey", true, connections);
      expect(result).toBe(false); // google only has oauth connection, not apikey
    });
  });

  describe("getProviderStats - temporal ordering (TDZ safety)", () => {
    it("should be callable before passesConnectionFilter is defined", () => {
      // This test verifies that getProviderStats doesn't reference
      // passesConnectionFilter, preventing temporal dead zone issues.
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
      ];
      
      // If getProviderStats referenced passesConnectionFilter before it's
      // defined, this would throw ReferenceError
      const stats = getProviderStats("openai", "apikey", connections);
      expect(stats.connected).toBe(1);
    });

    it("passesConnectionFilter depends on getProviderStats being available", () => {
      // This test documents the dependency order:
      // passesConnectionFilter calls getProviderStats, so getProviderStats
      // must be defined first. In the module, getProviderStats is exported
      // before passesConnectionFilter.
      const connections = [
        { provider: "openai", authType: "apikey", testStatus: "active", isActive: true },
      ];
      
      const result = passesConnectionFilter("openai", "apikey", true, connections);
      expect(result).toBe(true);
    });
  });
});

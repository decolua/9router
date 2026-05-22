// Tests for Kiro format RTK support
// Verifies that RTK compression works with Kiro's conversationState format
import { describe, it, expect } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";

describe("Kiro format RTK support", () => {
  it("compresses tool results in Kiro conversationState.currentMessage", () => {
    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-123",
        currentMessage: {
          userInputMessage: {
            content: "Install express",
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                {
                  toolUseId: "tool_1",
                  status: "success",
                  content: [
                    {
                      text: [
                        "npm warn deprecated har-validator@5.1.5: this library is no longer supported",
                        "npm warn deprecated uuid@3.4.0: uuid@10 and below is no longer supported",
                        "npm warn deprecated request@2.88.2: request has been deprecated",
                        "npm warn deprecated inflight@1.0.6: This module is not supported",
                        "npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
                        "npm warn deprecated rimraf@2.7.1: Rimraf versions prior to v4 are no longer supported",
                        "",
                        "added 47 packages, and audited 48 packages in 13s",
                        "",
                        "3 packages are looking for funding",
                        "  run `npm fund` for details",
                        "",
                        "4 vulnerabilities (2 moderate, 2 critical)",
                        "",
                        "Some issues need review, and may require choosing",
                        "a different dependency.",
                        "",
                        "Run `npm audit` for details."
                      ].join("\n")
                    }
                  ]
                }
              ]
            }
          }
        },
        history: []
      }
    };

    const stats = compressMessages(kiroBody, true);

    expect(stats).not.toBeNull();
    expect(stats.bytesBefore).toBeGreaterThan(500);
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("build-output");
    expect(stats.hits[0].shape).toBe("kiro-tool-result");

    // Verify compression happened
    const savedBytes = stats.bytesBefore - stats.bytesAfter;
    expect(savedBytes).toBeGreaterThan(0);
    const savedPercent = (savedBytes / stats.bytesBefore) * 100;
    expect(savedPercent).toBeGreaterThan(10); // At least 10% savings
  });

  it("compresses tool results in Kiro conversationState.history", () => {
    // Need >500 bytes for compression to trigger
    const compilingLines = [];
    for (let i = 1; i <= 20; i++) {
      compilingLines.push(`   Compiling package-${i} v1.0.${i}`);
    }
    compilingLines.push("    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.34s");

    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-456",
        currentMessage: {
          userInputMessage: {
            content: "What happened?",
            modelId: "claude-sonnet-4.5"
          }
        },
        history: [
          {
            userInputMessage: {
              content: "Run cargo build",
              modelId: "claude-sonnet-4.5",
              userInputMessageContext: {
                toolResults: [
                  {
                    toolUseId: "tool_2",
                    status: "success",
                    content: [
                      {
                        text: compilingLines.join("\n")
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }
    };

    const stats = compressMessages(kiroBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("build-output");
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
  });

  it("handles multiple tool results across history and currentMessage", () => {
    // Need >500 bytes for each tool result to trigger compression
    const deprecations1 = [];
    const deprecations2 = [];
    for (let i = 1; i <= 10; i++) {
      deprecations1.push(`npm warn deprecated package-${i}@1.0.0: This version is deprecated`);
      deprecations2.push(`npm warn deprecated lib-${i}@2.0.0: This library is no longer supported`);
    }
    deprecations1.push("added 50 packages in 5s");
    deprecations2.push("added 1 package in 2s");

    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-789",
        currentMessage: {
          userInputMessage: {
            content: "Install lodash",
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                {
                  toolUseId: "tool_3",
                  status: "success",
                  content: [
                    {
                      text: deprecations2.join("\n")
                    }
                  ]
                }
              ]
            }
          }
        },
        history: [
          {
            userInputMessage: {
              content: "Install express",
              modelId: "claude-sonnet-4.5",
              userInputMessageContext: {
                toolResults: [
                  {
                    toolUseId: "tool_4",
                    status: "success",
                    content: [
                      {
                        text: deprecations1.join("\n")
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }
    };

    const stats = compressMessages(kiroBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(2); // Both tool results compressed
    expect(stats.hits.every(h => h.filter === "build-output")).toBe(true);
  });

  it("preserves error tool results without compression", () => {
    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-error",
        currentMessage: {
          userInputMessage: {
            content: "Install invalid-package",
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                {
                  toolUseId: "tool_5",
                  status: "error",
                  content: [
                    {
                      text: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/invalid-package"
                    }
                  ]
                }
              ]
            }
          }
        },
        history: []
      }
    };

    const originalText = kiroBody.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text;
    const stats = compressMessages(kiroBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(0); // Error not compressed
    
    // Verify error text unchanged
    const afterText = kiroBody.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text;
    expect(afterText).toBe(originalText);
  });

  it("returns null when RTK is disabled", () => {
    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-disabled",
        currentMessage: {
          userInputMessage: {
            content: "Test",
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                {
                  toolUseId: "tool_6",
                  status: "success",
                  content: [{ text: "npm install express\nadded 50 packages" }]
                }
              ]
            }
          }
        },
        history: []
      }
    };

    const stats = compressMessages(kiroBody, false); // RTK disabled
    expect(stats).toBeNull();
  });

  it("handles Kiro body with no tool results gracefully", () => {
    const kiroBody = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "test-no-tools",
        currentMessage: {
          userInputMessage: {
            content: "Hello",
            modelId: "claude-sonnet-4.5"
          }
        },
        history: []
      }
    };

    const stats = compressMessages(kiroBody, true);

    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBe(0);
    expect(stats.bytesBefore).toBe(0);
    expect(stats.bytesAfter).toBe(0);
  });

  it("handles malformed Kiro body without crashing", () => {
    const malformedBodies = [
      { conversationState: null },
      { conversationState: {} },
      { conversationState: { history: null, currentMessage: null } },
      { conversationState: { history: "not-an-array" } }
    ];

    for (const body of malformedBodies) {
      const stats = compressMessages(body, true);
      // Malformed bodies may return null (caught by try-catch) or empty stats
      if (stats !== null) {
        expect(stats.hits.length).toBe(0);
      }
    }
  });
});

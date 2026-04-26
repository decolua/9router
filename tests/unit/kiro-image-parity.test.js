import { describe, expect, it } from "vitest";

import { buildKiroPayload } from "../../src/lib/open-sse/translator/request/openai-to-kiro.js";

describe("Kiro image parity", () => {
  it("keeps remote image URLs as image attachments instead of downgrading them to text", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this image" },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/cat.png",
              },
            },
          ],
        },
      ],
    };

    const payload = buildKiroPayload("kiro-test", body, true, {});
    const userMessage = payload.conversationState.currentMessage.userInputMessage;
    expect(userMessage.content).not.toContain("[Image: https://example.com/cat.png]");

    const allImages = [
      ...(userMessage.images || []),
      ...(userMessage.userInputMessageContext?.images || []),
      ...((payload.conversationState.history || [])
        .flatMap((entry) => [
          ...(entry.userInputMessage?.images || []),
          ...(entry.userInputMessage?.userInputMessageContext?.images || []),
        ])),
    ];

    expect(allImages).toEqual([
      {
        format: "png",
        source: { url: "https://example.com/cat.png" },
      },
    ]);
  });
});

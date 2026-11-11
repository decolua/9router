// The gRPC transport reads the schema from an embedded string, because the
// proto loader only takes a path and reading a file at import time breaks under
// the Next.js bundler. This test keeps the embedded copy honest: it must stay
// byte-identical to `proto/chat.proto`, which remains the reviewable source.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_PROTO_SOURCE } from "../../open-sse/shared/qoder/chat-proto.js";

const PROTO_PATH = fileURLToPath(new URL("../../open-sse/shared/qoder/proto/chat.proto", import.meta.url));

describe("qoder chat.proto", () => {
  it("is embedded verbatim", () => {
    expect(CHAT_PROTO_SOURCE).toBe(readFileSync(PROTO_PATH, "utf8"));
  });

  it("declares the streaming RPC the transport calls", () => {
    expect(CHAT_PROTO_SOURCE).toContain("service ChatService {");
    expect(CHAT_PROTO_SOURCE).toContain(
      "rpc ChatCompletionStream(ChatCompletionRequest) returns (stream ChatCompletionChunk);",
    );
    expect(CHAT_PROTO_SOURCE).toContain("package model.chat;");
  });

  it("carries the fields the request builder sets", () => {
    for (const field of [
      "repeated ChatMessage messages = 2;",
      "bool stream = 6;",
      "StreamOptions stream_options = 20;",
      "ChatMetadata metadata = 22;",
      "string text_content = 3;",
    ]) {
      expect(CHAT_PROTO_SOURCE).toContain(field);
    }
  });
});

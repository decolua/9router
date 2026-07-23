import { DefaultExecutor } from "./default.js";

// Windsurf chat = Codeium binary protobuf gRPC-Web.
// The .proto schema for exa.server_pb.ServerService is NOT in either source
// repo, so request/response encode+decode cannot be implemented truthfully.
// Auth, headers, quota are wired; the chat payload is intentionally a hard
// failure rather than a fabricated protobuf body.
export class WindsurfExecutor extends DefaultExecutor {
  constructor() {
    super("windsurf");
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/proto",
      "Connect-Protocol-Version": "1",
      ideName: "Windsurf",
      extensionName: "codeium.windsurf",
      ...(this.config.headers || {}),
    };
    // apiKey from RegisterUser (sk-ws-..., Firebase-derived, or Devin ide_token).
    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  // TODO(proto): implement once Codeium server_pb .proto is recovered.
  //  - encode request: chat history + model + system → protobuf bytes
  //  - decode response: stream protobuf frames → OpenAI-shaped chunks
  async execute() {
    throw new Error(
      "Windsurf chat (Codeium protobuf) not yet implemented — needs .proto schema. Auth/quota wired."
    );
  }

  async refreshCredentials() {
    // Windsurf apiKey is long-lived (like cursor); refresh handled out-of-band.
    return null;
  }
}

export default WindsurfExecutor;

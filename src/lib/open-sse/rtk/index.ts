import { getRtkEnabled } from "./flag";

function compressToolText(input: string): string {
  const text = input.trim();
  if (!text) return input;

  const lines = text.split(/\r?\n/);
  const numberedLines = lines.filter((line) => /^\s*\d+[\.)]\s+/.test(line)).length;
  const isLikelyEnumerated = lines.length >= 6 && numberedLines >= Math.floor(lines.length * 0.5);

  if (isLikelyEnumerated) {
    const head = lines.slice(0, 4);
    const tail = lines.slice(-2);
    const omitted = Math.max(0, lines.length - (head.length + tail.length));
    if (omitted <= 0) return input;
    const compressed = [...head, `... [RTK compressed ${omitted} lines]`, ...tail].join("\n").trim();
    return compressed || input;
  }

  if (text.length > 1200) {
    const head = text.slice(0, 700).trimEnd();
    const tail = text.slice(-250).trimStart();
    const compressed = `${head}\n... [RTK compressed ${text.length - (head.length + tail.length)} chars]\n${tail}`.trim();
    return compressed || input;
  }

  return input;
}

function processToolResultPart(part: any): void {
  if (!part || part.type !== "tool_result" || part.is_error) return;
  if (typeof part.content !== "string") return;

  const compressed = compressToolText(part.content);
  if (typeof compressed === "string" && compressed.length > 0) {
    part.content = compressed;
  }
}

function processToolMessage(message: any): void {
  if (!message || message.role !== "tool") return;
  if (message.is_error) return;
  if (typeof message.content !== "string") return;

  const compressed = compressToolText(message.content);
  if (typeof compressed === "string" && compressed.length > 0) {
    message.content = compressed;
  }
}

export function applyRtkFailOpen(body: any): any {
  try {
    if (!getRtkEnabled()) return body;
    if (!body || !Array.isArray(body.messages)) return body;

    for (const message of body.messages) {
      processToolMessage(message);

      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) {
        processToolResultPart(part);
      }
    }

    return body;
  } catch {
    return body;
  }
}

/**
 * Minimal SSE reader for the OpenAI chat-completions streaming shape:
 *
 *   data: {"id":...,"choices":[...]}
 *
 *   data: [DONE]
 *
 * The CLI has no streaming HTTP consumer anywhere yet, so this is the shared
 * parser for the ACP gateway client.
 */

class SseParser {
  constructor() {
    this.buffer = "";
  }

  /** Feed a decoded text chunk, get back the `data:` payloads seen so far. */
  push(text) {
    this.buffer += text;
    const events = [];
    // Frames are separated by a blank line; tolerate \r\n.
    let idx;
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const sepMatch = this.buffer.slice(idx).match(/^\r?\n\r?\n/);
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + sepMatch[0].length);
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("data:")) events.push(line.slice(5).replace(/^ /, ""));
      }
    }
    return events;
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  end() {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest) return [];
    const events = [];
    for (const line of rest.split(/\r?\n/)) {
      if (line.startsWith("data:")) events.push(line.slice(5).replace(/^ /, ""));
    }
    return events;
  }
}

module.exports = { SseParser };

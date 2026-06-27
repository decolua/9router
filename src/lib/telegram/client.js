// Tiny Telegram Bot API client. Just the methods the webhook handler needs.
// Docs: https://core.telegram.org/bots/api

const API_BASE = "https://api.telegram.org";

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return t;
}

async function call(method, body) {
  const res = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const desc = data?.description || res.statusText || "unknown";
    throw new Error(`telegram ${method} failed: ${desc}`);
  }
  return data.result;
}

// Multipart upload for sendPhoto/sendDocument/sendAudio. Telegram accepts media
// via either a file URL or a multipart blob. We always upload buffers, no temp
// files. The caller specifies the field name + mime type.
async function callMultipart(method, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (v && typeof v === "object" && (v instanceof Uint8Array || Buffer.isBuffer(v))) {
      // Default mime; specific upload helpers below override it.
      form.append(k, new Blob([v], { type: "application/octet-stream" }), `${k}.bin`);
    } else if (v && typeof v === "object" && v._file) {
      // Wrapped file object: { _file: true, buffer, mime, filename }
      form.append(k, new Blob([v.buffer], { type: v.mime || "application/octet-stream" }), v.filename || `${k}.bin`);
    } else {
      form.append(k, String(v));
    }
  }
  const res = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const desc = data?.description || res.statusText || "unknown";
    throw new Error(`telegram ${method} failed: ${desc}`);
  }
  return data.result;
}

export const telegram = {
  sendMessage(chatId, text, opts = {}) {
    return call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode || "HTML",
      disable_web_page_preview: true,
      reply_to_message_id: opts.replyTo,
      ...opts.extra,
    });
  },

  editMessage(chatId, messageId, text, opts = {}) {
    return call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: opts.parseMode || "HTML",
      disable_web_page_preview: true,
    });
  },

  sendChatAction(chatId, action = "typing") {
    return call("sendChatAction", { chat_id: chatId, action });
  },

  // Upload a PNG/JPEG image. Optional caption rendered as HTML.
  sendPhoto(chatId, photoBuffer, opts = {}) {
    return callMultipart("sendPhoto", {
      chat_id: chatId,
      photo: { _file: true, buffer: photoBuffer, mime: "image/png", filename: "photo.png" },
      caption: opts.caption || undefined,
      parse_mode: opts.caption ? "HTML" : undefined,
    });
  },

  // Upload audio (mp3/ogg/wav). For voice-note style use sendVoice instead.
  sendAudio(chatId, audioBuffer, opts = {}) {
    return callMultipart("sendAudio", {
      chat_id: chatId,
      audio: {
        _file: true,
        buffer: audioBuffer,
        mime: opts.mime || "audio/mpeg",
        filename: opts.filename || "audio.mp3",
      },
      caption: opts.caption || undefined,
      parse_mode: opts.caption ? "HTML" : undefined,
      title: opts.title || undefined,
    });
  },

  // Upload arbitrary file (used as fallback if sendAudio/sendPhoto fail).
  sendDocument(chatId, fileBuffer, opts = {}) {
    return callMultipart("sendDocument", {
      chat_id: chatId,
      document: {
        _file: true,
        buffer: fileBuffer,
        mime: opts.mime || "application/octet-stream",
        filename: opts.filename || "file.bin",
      },
      caption: opts.caption || undefined,
      parse_mode: opts.caption ? "HTML" : undefined,
    });
  },

  answerCallback(callbackQueryId, text) {
    return call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  },

  setWebhook(url, secretToken) {
    return call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  },

  deleteWebhook() {
    return call("deleteWebhook", { drop_pending_updates: true });
  },

  getWebhookInfo() {
    return call("getWebhookInfo", {});
  },
};

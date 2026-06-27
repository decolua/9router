// Media handling helpers for Telegram bot.
// Handles: photo analysis (vision), document/file reading, voice transcription,
// and song/music generation.

import { telegram } from "@/lib/telegram/client.js";
import { getDefaultModel } from "@/lib/telegram/conversations.js";

function gatewayBase() {
  return process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;
}

function gatewayKey() {
  const k = process.env.GATEWAY_API_KEY;
  if (!k) throw new Error("GATEWAY_API_KEY not set");
  return k;
}

// ─── Download file from Telegram ──────────────────────────────────────────

export async function downloadTelegramFile(fileId) {
  const fileInfo = await telegram.getFile(fileId);
  if (!fileInfo?.file_path) throw new Error("Telegram returned no file_path");
  const buffer = await telegram.downloadFile(fileInfo.file_path);
  return { buffer, filePath: fileInfo.file_path, fileSize: fileInfo.file_size || buffer.length };
}

// Get the best photo file_id (largest available resolution).
export function getBestPhotoFileId(photoArray) {
  if (!Array.isArray(photoArray) || photoArray.length === 0) return null;
  // Telegram sends multiple sizes; last is largest.
  return photoArray[photoArray.length - 1].file_id;
}

// ─── Photo / Image Analysis (Vision) ─────────────────────────────────────

// Vision-capable models prioritized. Adjust based on your connected providers.
const VISION_MODELS = [
  "kr/claude-sonnet-4.5",
  "cc/claude-sonnet-4-6",
  "gh/gpt-5.4",
  "cx/gpt-5.4",
  "vertex/gemini-3.1-pro-preview",
  "glm/glm-5.1",
];

export async function analyzeImage(chatId, imageBuffer, caption, mimeType = "image/jpeg") {
  const model = await pickVisionModel(chatId);
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const userContent = [
    {
      type: "image_url",
      image_url: { url: dataUrl },
    },
  ];

  // If user sent a caption with the photo, use it as the question.
  // Otherwise default to general analysis.
  const textPrompt = caption?.trim()
    ? caption.trim()
    : "Describe this image in detail. If it contains text, transcribe it. If it's a document, summarize the content. If it's code, explain what it does.";

  userContent.push({ type: "text", text: textPrompt });

  const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: userContent },
      ],
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vision API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "(no response)";
  return { text, model };
}

async function pickVisionModel(chatId) {
  // Try user's default model first (it might support vision).
  const userModel = await getDefaultModel(chatId);
  // Check if it's known to support vision
  const allCandidates = [userModel, ...VISION_MODELS.filter((m) => m !== userModel)];
  // For now, just return the first candidate. The gateway will error if it can't handle vision.
  return allCandidates[0];
}

// ─── Document / File Analysis ─────────────────────────────────────────────

// Supported text-extractable formats
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "csv", "xml", "html", "htm", "yaml", "yml",
  "js", "ts", "py", "rb", "java", "c", "cpp", "h", "go", "rs",
  "sh", "bash", "sql", "env", "toml", "ini", "cfg", "log",
]);

export async function analyzeDocument(chatId, fileBuffer, fileName, mimeType, caption) {
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
  const model = await getDefaultModel(chatId);

  let extractedText = "";

  // For PDF: try to extract text (basic approach — look for text streams)
  if (ext === "pdf" || mimeType === "application/pdf") {
    extractedText = extractPdfText(fileBuffer);
    if (!extractedText) {
      // If text extraction failed, try sending as image to vision model (first page)
      return {
        text: "This PDF appears to be image-based (scanned). Send it as a photo or screenshot for visual analysis.",
        model: "system",
      };
    }
  }
  // For known text formats: just decode
  else if (TEXT_EXTENSIONS.has(ext) || mimeType?.startsWith("text/")) {
    extractedText = fileBuffer.toString("utf-8");
  }
  // For spreadsheets/office docs: basic text extraction attempt
  else if (ext === "csv") {
    extractedText = fileBuffer.toString("utf-8");
  }
  // Unknown binary: inform user
  else {
    return {
      text: `I can't read \`.${ext}\` files directly. Supported formats:\n` +
        `- Text/code: txt, md, json, csv, xml, html, js, ts, py, etc.\n` +
        `- PDF (text-based)\n\n` +
        `For images/screenshots, send them as photos instead.`,
      model: "system",
    };
  }

  if (!extractedText.trim()) {
    return { text: "The file appears to be empty or unreadable.", model: "system" };
  }

  // Truncate very large files
  const maxChars = 30000;
  const truncated = extractedText.length > maxChars;
  const content = truncated
    ? extractedText.slice(0, maxChars) + "\n\n[... truncated, file too large ...]"
    : extractedText;

  const question = caption?.trim()
    ? caption.trim()
    : "Analyze this file. Summarize its content, highlight key points, and note anything important.";

  const systemPrompt = `You are analyzing a file named "${fileName}" (${ext}, ${formatFileSize(fileBuffer.length)}).${truncated ? " Note: content was truncated due to size." : ""}`;

  const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `FILE CONTENT:\n\`\`\`\n${content}\n\`\`\`\n\nQUESTION: ${question}` },
      ],
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`File analysis API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "(no response)";
  return { text, model };
}

// Basic PDF text extraction — looks for text between BT/ET operators.
// Won't work for scanned/image PDFs. Good enough for most text PDFs.
function extractPdfText(buffer) {
  try {
    const raw = buffer.toString("latin1");
    const textChunks = [];

    // Method 1: Extract text between parentheses in BT...ET blocks
    const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
    for (const block of btBlocks) {
      const strings = block.match(/\(([^)]*)\)/g) || [];
      for (const s of strings) {
        const decoded = s.slice(1, -1)
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\\\/g, "\\")
          .replace(/\\(\(|\))/g, "$1");
        if (decoded.trim()) textChunks.push(decoded);
      }
    }

    // Method 2: Look for streams that might contain readable text
    if (textChunks.length === 0) {
      const readable = raw.match(/[\x20-\x7E]{20,}/g) || [];
      for (const chunk of readable.slice(0, 200)) {
        if (!/^(%|\/|<<|>>|\d+ \d+ obj|endobj|stream|endstream|xref)/.test(chunk)) {
          textChunks.push(chunk);
        }
      }
    }

    const result = textChunks.join(" ").replace(/\s+/g, " ").trim();
    return result.length > 50 ? result : ""; // Only return if we got meaningful content
  } catch {
    return "";
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Voice Message Transcription (STT) ────────────────────────────────────

export async function transcribeVoice(voiceBuffer, mimeType = "audio/ogg") {
  // Use the gateway's STT endpoint
  const form = new FormData();
  form.append("file", new Blob([voiceBuffer], { type: mimeType }), "voice.ogg");
  form.append("model", "whisper-1"); // The gateway routes to whatever STT provider is configured

  const res = await fetch(`${gatewayBase()}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayKey()}` },
    body: form,
  });

  if (!res.ok) {
    // If STT endpoint not available, return null so caller can fallback
    const body = await res.text().catch(() => "");
    if (res.status === 404) return null; // no STT provider configured
    throw new Error(`STT ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.text || data?.transcription || null;
}

// ─── Song / Music Generation ──────────────────────────────────────────────

export async function generateSong(chatId, opts = {}) {
  const model = await getDefaultModel(chatId);
  const { topic, genre, mood, language } = opts;

  const systemPrompt = [
    "You are a talented songwriter and music producer.",
    "When asked to write a song, create complete lyrics with:",
    "- A catchy title",
    "- Verse/Chorus/Bridge structure clearly labeled",
    "- Suggested tempo, key, and genre notes at the top",
    "- Emotional tone and production notes",
    "If a genre or mood is specified, match it closely.",
    "Make the lyrics creative, memorable, and singable.",
  ].join("\n");

  const parts = ["Write a complete song"];
  if (topic) parts.push(`about: ${topic}`);
  if (genre) parts.push(`Genre: ${genre}`);
  if (mood) parts.push(`Mood/vibe: ${mood}`);
  if (language) parts.push(`Language: ${language}`);
  parts.push("\nInclude the full lyrics with structure labels (Verse 1, Chorus, Verse 2, Bridge, Outro etc.).");

  const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parts.join("\n") },
      ],
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Song generation ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "(no lyrics generated)";
  return { text, model };
}

// Try to generate actual audio of the song using a music model (if available).
// Returns a buffer or null if no music generation model is connected.
export async function generateSongAudio(chatId, lyrics, genre) {
  // Check if any music generation models are available
  try {
    const res = await fetch(`${gatewayBase()}/v1/models/music`, {
      headers: { Authorization: `Bearer ${gatewayKey()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const models = data?.data || [];
    if (models.length === 0) return null;

    // Use the first available music model
    const musicModel = models[0].id;
    const prompt = `${genre ? `${genre} song: ` : ""}${lyrics.slice(0, 500)}`;

    const audioRes = await fetch(`${gatewayBase()}/v1/audio/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
      body: JSON.stringify({
        model: musicModel,
        prompt,
        duration: 30, // 30 seconds
      }),
    });

    if (!audioRes.ok) return null;

    const ct = audioRes.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const j = await audioRes.json().catch(() => null);
      const b64 = j?.audio || j?.data?.[0]?.b64 || j?.b64_json;
      if (b64) return Buffer.from(b64, "base64");
      return null;
    }
    return Buffer.from(await audioRes.arrayBuffer());
  } catch {
    return null;
  }
}

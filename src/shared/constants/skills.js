// Agent Skills metadata — single source of truth for /dashboard/skills page.
// Each skill = one raw GitHub URL the user can send to an AI agent.

const REPO = "decolua/9router";
const BRANCH = "master";
const SKILL_PATH = "skills";

export const SKILLS_REPO_URL = `https://github.com/${REPO}`;
export const SKILLS_RAW_BASE = `https://raw.githubusercontent.com/${REPO}/refs/heads/${BRANCH}/${SKILL_PATH}`;
export const SKILLS_BLOB_BASE = `https://github.com/${REPO}/blob/${BRANCH}/${SKILL_PATH}`;

export const SKILLS = [
  {
    id: "9router",
    name: "9Router (Entry)",
    description: "Start here: base URL, auth, model discovery, and every capability link.",
    endpoint: null,
    icon: "hub",
    isEntry: true,
  },
  {
    id: "9router-chat",
    name: "Chat",
    description: "Stream chat and code requests in OpenAI or Anthropic format.",
    endpoint: "/v1/chat/completions",
    icon: "chat",
  },
  {
    id: "9router-image",
    name: "Image Generation",
    description: "Generate images through DALL-E, Imagen, FLUX, MiniMax, or SDWebUI.",
    endpoint: "/v1/images/generations",
    icon: "image",
  },
  {
    id: "9router-tts",
    name: "Text-to-Speech",
    description: "Create speech with OpenAI, ElevenLabs, Edge, Google, or Deepgram voices.",
    endpoint: "/v1/audio/speech",
    icon: "record_voice_over",
  },
  {
    id: "9router-stt",
    name: "Speech-to-Text",
    description: "Transcribe audio with Whisper, Groq, Gemini, Deepgram, or AssemblyAI.",
    endpoint: "/v1/audio/transcriptions",
    icon: "mic",
  },
  {
    id: "9router-embeddings",
    name: "Embeddings",
    description: "Create vectors for RAG and semantic search across embedding providers.",
    endpoint: "/v1/embeddings",
    icon: "scatter_plot",
  },
  {
    id: "9router-web-search",
    name: "Web Search",
    description: "Search the web through Tavily, Exa, Brave, Serper, SearXNG, Google PSE, or You.com.",
    endpoint: "/v1/search",
    icon: "search",
  },
  {
    id: "9router-web-fetch",
    name: "Web Fetch",
    description: "Fetch URLs as markdown, text, or HTML through Firecrawl, Jina, Tavily, or Exa.",
    endpoint: "/v1/web/fetch",
    icon: "language",
  },
];

export function getSkillRawUrl(id) {
  return `${SKILLS_RAW_BASE}/${id}/SKILL.md`;
}

export function getSkillBlobUrl(id) {
  return `${SKILLS_BLOB_BASE}/${id}/SKILL.md`;
}

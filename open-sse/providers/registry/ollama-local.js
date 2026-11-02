export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama",
  },
  models: [
    { id: "clef", name: "Clef", kind: "systemone" },
    { id: "clef-flash", name: "Clef Flash", kind: "systemone" },
    { id: "phonon:latest",           name: "Phonon (Latest)",         kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon",                  name: "Phonon",                  kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:multilingual",     name: "Phonon Multilingual",     kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-multilingual", name: "Phonon 40M Multilingual", kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:en",               name: "Phonon English",          kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:31m-en",           name: "Phonon 31M English",      kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-en",           name: "Phonon 40M English",      kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:de",               name: "Phonon German",           kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-de",           name: "Phonon 40M German",       kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:es",               name: "Phonon Spanish",          kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-es",           name: "Phonon 40M Spanish",      kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:fr",               name: "Phonon French",           kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-fr",           name: "Phonon 40M French",       kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:pt",               name: "Phonon Portuguese",       kind: "tts", params: ["voice", "response_format"] },
    { id: "phonon:40m-pt",           name: "Phonon 40M Portuguese",   kind: "tts", params: ["voice", "response_format"] },

    // Ollama Embedding Models (https://ollama.com/search?c=embedding)
    // nomic-embed-text
    { id: "nomic-embed-text",                     name: "Nomic Embed Text",                      kind: "embedding", dimensions: 768 },
    { id: "nomic-embed-text:latest",              name: "Nomic Embed Text (Latest)",             kind: "embedding", dimensions: 768 },
    { id: "nomic-embed-text:v1.5",                name: "Nomic Embed Text v1.5",                 kind: "embedding", dimensions: 768 },
    { id: "nomic-embed-text:137m-v1.5-fp16",      name: "Nomic Embed Text 137M v1.5 (FP16)",     kind: "embedding", dimensions: 768 },

    // nomic-embed-text-v2-moe
    { id: "nomic-embed-text-v2-moe",              name: "Nomic Embed Text v2 MoE",               kind: "embedding", dimensions: 768 },
    { id: "nomic-embed-text-v2-moe:latest",       name: "Nomic Embed Text v2 MoE (Latest)",      kind: "embedding", dimensions: 768 },

    // qwen3-embedding
    { id: "qwen3-embedding",                      name: "Qwen3 Embedding",                       kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:latest",               name: "Qwen3 Embedding (Latest)",              kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:8b",                   name: "Qwen3 Embedding 8B",                    kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:8b-q4_K_M",            name: "Qwen3 Embedding 8B (Q4_K_M)",           kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:8b-q8_0",              name: "Qwen3 Embedding 8B (Q8_0)",             kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:8b-fp16",              name: "Qwen3 Embedding 8B (FP16)",             kind: "embedding", dimensions: 4096 },
    { id: "qwen3-embedding:4b",                   name: "Qwen3 Embedding 4B",                    kind: "embedding", dimensions: 2560 },
    { id: "qwen3-embedding:4b-q4_K_M",            name: "Qwen3 Embedding 4B (Q4_K_M)",           kind: "embedding", dimensions: 2560 },
    { id: "qwen3-embedding:4b-q8_0",              name: "Qwen3 Embedding 4B (Q8_0)",             kind: "embedding", dimensions: 2560 },
    { id: "qwen3-embedding:4b-fp16",              name: "Qwen3 Embedding 4B (FP16)",             kind: "embedding", dimensions: 2560 },
    { id: "qwen3-embedding:0.6b",                 name: "Qwen3 Embedding 0.6B",                  kind: "embedding", dimensions: 1024 },
    { id: "qwen3-embedding:0.6b-q8_0",            name: "Qwen3 Embedding 0.6B (Q8_0)",           kind: "embedding", dimensions: 1024 },
    { id: "qwen3-embedding:0.6b-fp16",            name: "Qwen3 Embedding 0.6B (FP16)",           kind: "embedding", dimensions: 1024 },

    // bge-m3
    { id: "bge-m3",                               name: "BGE M3",                                kind: "embedding", dimensions: 1024 },
    { id: "bge-m3:latest",                        name: "BGE M3 (Latest)",                       kind: "embedding", dimensions: 1024 },
    { id: "bge-m3:567m",                          name: "BGE M3 567M",                           kind: "embedding", dimensions: 1024 },
    { id: "bge-m3:567m-fp16",                     name: "BGE M3 567M (FP16)",                    kind: "embedding", dimensions: 1024 },

    // bge-large
    { id: "bge-large",                            name: "BGE Large",                             kind: "embedding", dimensions: 1024 },
    { id: "bge-large:latest",                     name: "BGE Large (Latest)",                    kind: "embedding", dimensions: 1024 },
    { id: "bge-large:335m",                       name: "BGE Large 335M",                        kind: "embedding", dimensions: 1024 },
    { id: "bge-large:335m-en-v1.5-fp16",          name: "BGE Large 335M EN v1.5 (FP16)",         kind: "embedding", dimensions: 1024 },

    // mxbai-embed-large
    { id: "mxbai-embed-large",                    name: "mxbai Embed Large",                     kind: "embedding", dimensions: 1024 },
    { id: "mxbai-embed-large:latest",             name: "mxbai Embed Large (Latest)",            kind: "embedding", dimensions: 1024 },
    { id: "mxbai-embed-large:335m",               name: "mxbai Embed Large 335M",                kind: "embedding", dimensions: 1024 },
    { id: "mxbai-embed-large:v1",                 name: "mxbai Embed Large v1",                  kind: "embedding", dimensions: 1024 },
    { id: "mxbai-embed-large:335m-v1-fp16",       name: "mxbai Embed Large 335M v1 (FP16)",      kind: "embedding", dimensions: 1024 },

    // embeddinggemma
    { id: "embeddinggemma",                       name: "EmbeddingGemma",                        kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma:latest",                name: "EmbeddingGemma (Latest)",               kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma:300m",                  name: "EmbeddingGemma 300M",                   kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma:300m-bf16",             name: "EmbeddingGemma 300M (BF16)",            kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma:300m-qat-q4_0",         name: "EmbeddingGemma 300M (QAT Q4_0)",        kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma:300m-qat-q8_0",         name: "EmbeddingGemma 300M (QAT Q8_0)",        kind: "embedding", dimensions: 768 },

    // embeddinggemma-2
    { id: "embeddinggemma-2",                     name: "EmbeddingGemma 2",                      kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:latest",              name: "EmbeddingGemma 2 (Latest)",             kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:740m",                name: "EmbeddingGemma 2 740M",                 kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:740m-bf16",           name: "EmbeddingGemma 2 740M (BF16)",          kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:740m-q8_0",           name: "EmbeddingGemma 2 740M (Q8_0)",          kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:570m",                name: "EmbeddingGemma 2 570M",                 kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:570m-bf16-text-audio",name: "EmbeddingGemma 2 570M Audio (BF16)",    kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:570m-q8_0-text-audio",name: "EmbeddingGemma 2 570M Audio (Q8_0)",    kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:440m",                name: "EmbeddingGemma 2 440M",                 kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:440m-bf16-text-vision", name: "EmbeddingGemma 2 440M Vision (BF16)",kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:440m-q8_0-text-vision", name: "EmbeddingGemma 2 440M Vision (Q8_0)",kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:270m",                name: "EmbeddingGemma 2 270M",                 kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:270m-bf16-text",      name: "EmbeddingGemma 2 270M Text (BF16)",     kind: "embedding", dimensions: 768 },
    { id: "embeddinggemma-2:270m-q8_0-text",      name: "EmbeddingGemma 2 270M Text (Q8_0)",     kind: "embedding", dimensions: 768 },

    // all-minilm
    { id: "all-minilm",                           name: "All-MiniLM",                            kind: "embedding", dimensions: 384 },
    { id: "all-minilm:latest",                    name: "All-MiniLM (Latest)",                   kind: "embedding", dimensions: 384 },
    { id: "all-minilm:33m",                       name: "All-MiniLM 33M (L12)",                  kind: "embedding", dimensions: 384 },
    { id: "all-minilm:22m",                       name: "All-MiniLM 22M (L6)",                   kind: "embedding", dimensions: 384 },
    { id: "all-minilm:l12-v2",                    name: "All-MiniLM L12 v2",                     kind: "embedding", dimensions: 384 },
    { id: "all-minilm:l6-v2",                     name: "All-MiniLM L6 v2",                      kind: "embedding", dimensions: 384 },
    { id: "all-minilm:33m-l12-v2-fp16",           name: "All-MiniLM 33M L12 v2 (FP16)",          kind: "embedding", dimensions: 384 },
    { id: "all-minilm:22m-l6-v2-fp16",            name: "All-MiniLM 22M L6 v2 (FP16)",           kind: "embedding", dimensions: 384 },

    // snowflake-arctic-embed
    { id: "snowflake-arctic-embed",               name: "Snowflake Arctic Embed",                kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed:latest",        name: "Snowflake Arctic Embed (Latest)",       kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed:335m",          name: "Snowflake Arctic Embed 335M (L)",       kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed:137m",          name: "Snowflake Arctic Embed 137M (M-Long)",  kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:110m",          name: "Snowflake Arctic Embed 110M (M)",       kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:33m",           name: "Snowflake Arctic Embed 33M (S)",        kind: "embedding", dimensions: 384 },
    { id: "snowflake-arctic-embed:22m",           name: "Snowflake Arctic Embed 22M (XS)",       kind: "embedding", dimensions: 384 },
    { id: "snowflake-arctic-embed:l",             name: "Snowflake Arctic Embed L",              kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed:m",             name: "Snowflake Arctic Embed M",              kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:m-long",        name: "Snowflake Arctic Embed M-Long",         kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:s",             name: "Snowflake Arctic Embed S",              kind: "embedding", dimensions: 384 },
    { id: "snowflake-arctic-embed:xs",            name: "Snowflake Arctic Embed XS",             kind: "embedding", dimensions: 384 },
    { id: "snowflake-arctic-embed:335m-l-fp16",   name: "Snowflake Arctic Embed 335M L (FP16)",  kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed:137m-m-long-fp16", name: "Snowflake Arctic Embed 137M M-Long (FP16)", kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:110m-m-fp16",   name: "Snowflake Arctic Embed 110M M (FP16)",  kind: "embedding", dimensions: 768 },
    { id: "snowflake-arctic-embed:33m-s-fp16",    name: "Snowflake Arctic Embed 33M S (FP16)",   kind: "embedding", dimensions: 384 },
    { id: "snowflake-arctic-embed:22m-xs-fp16",   name: "Snowflake Arctic Embed 22M XS (FP16)",  kind: "embedding", dimensions: 384 },

    // snowflake-arctic-embed2
    { id: "snowflake-arctic-embed2",              name: "Snowflake Arctic Embed 2",              kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed2:latest",       name: "Snowflake Arctic Embed 2 (Latest)",     kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed2:568m",         name: "Snowflake Arctic Embed 2 568M",         kind: "embedding", dimensions: 1024 },
    { id: "snowflake-arctic-embed2:568m-l-fp16",  name: "Snowflake Arctic Embed 2 568M L (FP16)",kind: "embedding", dimensions: 1024 },

    // granite-embedding
    { id: "granite-embedding",                    name: "Granite Embedding",                     kind: "embedding", dimensions: 384 },
    { id: "granite-embedding:latest",             name: "Granite Embedding (Latest)",            kind: "embedding", dimensions: 384 },
    { id: "granite-embedding:278m",               name: "Granite Embedding 278M (Multilingual)", kind: "embedding", dimensions: 768 },
    { id: "granite-embedding:30m",                name: "Granite Embedding 30M (EN)",            kind: "embedding", dimensions: 384 },
    { id: "granite-embedding:30m-en",             name: "Granite Embedding 30M EN",              kind: "embedding", dimensions: 384 },
    { id: "granite-embedding:278m-fp16",          name: "Granite Embedding 278M (FP16)",         kind: "embedding", dimensions: 768 },
    { id: "granite-embedding:30m-en-fp16",        name: "Granite Embedding 30M EN (FP16)",       kind: "embedding", dimensions: 384 },

    // paraphrase-multilingual
    { id: "paraphrase-multilingual",              name: "Paraphrase Multilingual",               kind: "embedding", dimensions: 768 },
    { id: "paraphrase-multilingual:latest",       name: "Paraphrase Multilingual (Latest)",      kind: "embedding", dimensions: 768 },
    { id: "paraphrase-multilingual:278m",         name: "Paraphrase Multilingual 278M",          kind: "embedding", dimensions: 768 },
    { id: "paraphrase-multilingual:278m-mpnet-base-v2-fp16", name: "Paraphrase Multilingual 278M (FP16)", kind: "embedding", dimensions: 768 },

    // laya
    { id: "laya",                                 name: "Laya",                                  kind: "embedding", dimensions: 1024 },
    { id: "laya:latest",                          name: "Laya (Latest)",                         kind: "embedding", dimensions: 1024 },
    { id: "laya:421m-english-bf16",               name: "Laya 421M English (BF16)",              kind: "embedding", dimensions: 1024 },
    { id: "laya:322m-multilingual-bf16",          name: "Laya 322M Multilingual (BF16)",         kind: "embedding", dimensions: 1024 },
    { id: "laya:421m-typed-decisions-bf16",       name: "Laya 421M Decisions (BF16)",            kind: "embedding", dimensions: 1024 },
  ],
  serviceKinds: ["llm", "systemone", "tts", "embedding"],
  systemoneConfig: {
    baseUrl: "http://localhost:11434/v1/systemone",
    // Saved host (providerSpecificData.baseUrl) is joined with this path.
    path: "/v1/systemone",
  },
  ttsConfig: {
    baseUrl: "http://localhost:11434/v1/audio/speech",
    path: "/v1/audio/speech",
    defaultModel: "phonon",
    authType: "apikey",
    format: "openai",
  },
  embeddingConfig: {
    baseUrl: "http://localhost:11434/v1/embeddings",
    path: "/v1/embeddings",
    authType: "none",
  },
};

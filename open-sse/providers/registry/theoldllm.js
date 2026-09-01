export default {
    id: "theoldllm",
    alias: "tllm",
    uiAlias: "tllm",
    hasFree: true,

    display: {
        name: "The Old LLM",
        icon: "auto_awesome",
        textIcon: "TL",
        website: "https://theoldllm.vercel.app"
    },

    category: "free",
    noAuth: true,
    format: "openai",
    executor: "theoldllm",
    baseUrl: "https://theoldllm.vercel.app/api/chatgpt",
    baseUrls: [
        "https://theoldllm.vercel.app/api/chatgpt"
    ],
    authType: "none",
    authHeader: "none",

    transport: {
        baseUrl: "https://theoldllm.vercel.app/api/chatgpt",
        noAuth: true,
        timeoutMs: 120000
    },
    defaultContextLength: 200000,
    models: [
        {
            id: "GPT_5_4",
            name: "GPT-5.4 (The Old LLM 🆓)",
            contextLength: 400000
        },
        {
            id: "GPT_5_3",
            name: "GPT-5.3 (The Old LLM 🆓)",
            contextLength: 400000
        },
        {
            id: "GPT_5_2",
            name: "GPT-5.2 (The Old LLM 🆓)",
            contextLength: 400000
        },
        {
            id: "GPT_5_1",
            name: "GPT-5.1 (The Old LLM 🆓)",
            contextLength: 400000
        },
        {
            id: "GPT_5",
            name: "GPT-5 (The Old LLM 🆓)",
            contextLength: 400000
        },
        {
            id: "GPT_o4_mini",
            name: "o4-mini (The Old LLM 🆓)"
        },
        {
            id: "GPT_o3_mini",
            name: "o3-mini (The Old LLM 🆓)"
        },
        {
            id: "gemini_3_pro",
            name: "Gemini 3 Pro (The Old LLM 🆓)",
            contextLength: 1000000
        },
        {
            id: "gemini_2_5_pro",
            name: "Gemini 2.5 Pro (The Old LLM 🆓)",
            contextLength: 1000000
        },
        {
            id: "gemini_2_0_flash",
            name: "Gemini 2.0 Flash (The Old LLM 🆓)",
            contextLength: 1000000
        },
        {
            id: "gemini_1_5_flash",
            name: "Gemini 1.5 Flash (The Old LLM 🆓)",
            contextLength: 1000000
        },
        {
            id: "CLAUDE_4_6_OPUS",
            name: "Claude 4.6 Opus (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "CLAUDE_4_6_SONNET",
            name: "Claude 4.6 Sonnet (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "CLAUDE_4_5_HAIKU",
            name: "Claude 4.5 Haiku (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "openrouter_gpt_4_o",
            name: "GPT-4o (The Old LLM 🆓)"
        },
        {
            id: "openrouter_gpt_4_o_mini",
            name: "GPT-4o mini (The Old LLM 🆓)"
        },
        {
            id: "openrouter_grok_4",
            name: "Grok 4 (The Old LLM 🆓)"
        },
        {
            id: "together_deepseek_v3",
            name: "DeepSeek V3 (The Old LLM 🆓)"
        },
        {
            id: "openrouter_deepseek_r1",
            name: "DeepSeek R1 (The Old LLM 🆓)"
        },
        {
            id: "sonar-pro",
            name: "Sonar Pro (The Old LLM 🆓)"
        },
        {
            id: "GPT_4o",
            name: "GPT-4o (The Old LLM 🆓)"
        },
        {
            id: "claude_opus_4",
            name: "Claude Opus 4 (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "claude_sonnet_4",
            name: "Claude Sonnet 4 (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "claude_haiku_3_5",
            name: "Claude Haiku 3.5 (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "deepseek_v4",
            name: "DeepSeek V4 (The Old LLM 🆓)",
            contextLength: 200000
        },
        {
            id: "gemini_3_flash",
            name: "Gemini 3 Flash (The Old LLM 🆓)",
            contextLength: 1000000
        }
    ],
    passthroughModels: true,
    serviceKinds: ["llm"],
};

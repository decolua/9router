export default {
  id: "kilocode",
  priority: 70,
  alias: "kc",
  uiAlias: "kc",
  display: {
    name: "Kilo Code",
    icon: "code",
    color: "#FF6B35",
    textIcon: "KC",
    website: "https://kilocode.ai",
    notice: {
      signupUrl: "https://kilocode.ai",
    },
  },
  category: "custom",
  transport: {
    // Перенаправляем базовый URL на ваш локальный шлюз 9router
    baseUrl: "http://localhost:20128/v1/chat/completions",
    headers: {},
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      // Ваш рабочий токен оркестратора
      token: "sk-1cf548be0804e556-r2phva-9d993e27"
    },
  },
  models: [
    // Сохраняем облачные модели, которые идут через ваш RouterAI
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" },
    
    // ДОБАВЛЯЕМ ВСЕ ВАШИ ЛОКАЛЬНЫЕ МОДЕЛИ ИЗ OLLAMA:
    
    // 1. Модель со зрением для моментального распознавания скриншотов по Ctrl+V
    { 
      id: "ollama/llama3.2-vision:11b", 
      name: "Llama 3.2 Vision (Локальные глаза)",
      capabilities: ["vision", "chat"],
      contextWindow: 16384 // Ограничиваем до 16k под картинки, чтобы не забивать RAM
    },
    // 2. Ваш главный локальный кодер для VS Code
    { 
      id: "ollama/qwen3-coder:30b", 
      name: "Qwen 3 Coder (30B MoE)",
      capabilities: ["code", "chat", "debug"],
      contextWindow: 65536 // Даем полные 64k контекста для кода
    },
    // 3. Флагманская текстовая модель для сложной логики
    { 
      id: "ollama/qwen3.6:35b", 
      name: "Qwen 3.6 (35B Архитектор)",
      capabilities: ["chat", "plan"],
      contextWindow: 65536
    },
    // 4. Легкий агент для фоновой работы
    { 
      id: "ollama/hermes3:8b", 
      name: "Hermes 3 (8B Агент)",
      capabilities: ["chat", "agent"],
      contextWindow: 32768
    }
  ],
  
  // Перенаправляем динамический сборщик каталога на ваш локальный шлюз
  modelsFetcher: { 
    url: "http://localhost:20128/v1/models", 
    type: "openrouter-free" 
  },
  
  // СТРОГО FALSE: отключаем проброс встроенного платного хлама Kilo и старых кэшей
  passthroughModels: false, 
  
  oauth: null // Полностью выключаем внешнюю авторизацию и платные подписки
};

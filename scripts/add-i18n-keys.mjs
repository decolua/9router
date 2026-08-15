import { readFileSync, writeFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LITERALS_DIR = `${__dirname}/../public/i18n/literals`;

// All new English strings that need translations
const NEW_KEYS = [
  // models/page.js controls
  "Active",
  "All",
  "Expand all",
  "Collapse all",
  "All built-in and custom models across providers.",
  "models.dev catalog is unavailable.",
  "Refreshing...",
  "Refresh models.dev",
  "Search by model id, name or alias...",
  "All providers",
  "No models found.",
  "Importing...",
  "Import from models.dev",
  "Edit model",
  "Enable model",
  "Disable model",
  "Delete custom model",
  "Delete Custom Model",

  // EditModelModal.js
  "Alias",
  "Friendly name for routing",
  "Capabilities",
  "Reset to defaults",
  "Context window (tokens)",
  "Max output (tokens)",
  "Pricing",
  "($ per 1M tokens, empty = unset)",
  "Vision (image input)",
  "Reasoning / thinking",
  "Tool calling",
  "PDF input",
  "Image output",
  "Audio input",
  "Input",
  "Output",
  "Cached input",
  "Cache creation",

  // ImportModelsModal.js
  "Import Models from Provider",
  "Done",
  "Fetching models from provider...",
  "Search models...",
  "Select All",
  "No models match the search",
  "added",
  "Provider returned 0 models",

  // CompatibleModelsSection.js
  "Model ID",
  "Adding...",
  "Import from /models",
  "Set a Base URL on the active connection to enable importing models.",
  "Add a connection to enable importing models.",
  "Remove model",
  "Copied!",
  "Testing...",
  "Test",

  // ModelsCard.js
  "Add Custom Model",
  "Remove custom model",
  "FREE",

  // Sidebar.js / Header.js
  "Models",
  "Browse and edit models across all providers",

  // Header.js — previously untranslated page titles/descriptions
  "Usage & Analytics",
  "Auth Files",
  "Map provider credentials stored in the local database",
  "Track and manage your API quota limits",
  "MITM Proxy",
  "Token Saver",
  "Compress prompts and outputs to save tokens",
  "Proxy Pools",
  "Manage your proxy pool configurations",
  "Agent Skills",
  "Copy a link and paste to your AI to use 9Router — no install needed",
  "Media Providers",
  "Manage your",
  "providers",
];

// Russian translations
const RU = {
  "Active": "Активные",
  "All": "Все",
  "Expand all": "Развернуть все",
  "Collapse all": "Свернуть все",
  "models.dev catalog is unavailable.": "Каталог models.dev недоступен.",
  "Refreshing...": "Обновление...",
  "Refresh models.dev": "Обновить models.dev",
  "Search by model id, name or alias...": "Поиск по ID, имени или псевдониму модели...",
  "All providers": "Все провайдеры",
  "No models found.": "Модели не найдены.",
  "Importing...": "Импорт...",
  "Import from models.dev": "Импорт из models.dev",
  "Edit model": "Редактировать модель",
  "Enable model": "Включить модель",
  "Disable model": "Отключить модель",
  "Delete custom model": "Удалить модель",
  "Delete Custom Model": "Удалить модель",
  "Alias": "Псевдоним",
  "Friendly name for routing": "Понятное имя для маршрутизации",
  "Capabilities": "Возможности",
  "Reset to defaults": "Сбросить к значениям по умолчанию",
  "Context window (tokens)": "Контекстное окно (токенов)",
  "Max output (tokens)": "Макс. вывод (токенов)",
  "Pricing": "Цены",
  "($ per 1M tokens, empty = unset)": "($ за 1M токенов, пусто = не задано)",
  "Vision (image input)": "Зрение (ввод изображений)",
  "Reasoning / thinking": "Рассуждение / обдумывание",
  "Tool calling": "Вызов инструментов",
  "PDF input": "Ввод PDF",
  "Image output": "Вывод изображений",
  "Audio input": "Ввод аудио",
  "Input": "Ввод",
  "Output": "Вывод",
  "Cached input": "Кэшированный ввод",
  "Cache creation": "Создание кэша",
  "Import Models from Provider": "Импорт моделей от провайдера",
  "Done": "Готово",
  "Fetching models from provider...": "Получение моделей от провайдера...",
  "Search models...": "Поиск моделей...",
  "Select All": "Выбрать все",
  "No models match the search": "Нет моделей по запросу",
  "added": "добавлено",
  "Provider returned 0 models": "Провайдер вернул 0 моделей",
  "Model ID": "ID модели",
  "Adding...": "Добавление...",
  "Import from /models": "Импорт из /models",
  "Set a Base URL on the active connection to enable importing models.": "Укажите Base URL в активном подключении для импорта моделей.",
  "Add a connection to enable importing models.": "Добавьте подключение для импорта моделей.",
  "Remove model": "Удалить модель",
  "Copied!": "Скопировано!",
  "Testing...": "Тестирование...",
  "Test": "Тест",
  "Add Custom Model": "Добавить модель",
  "Remove custom model": "Удалить модель",
  "FREE": "БЕСПЛАТНО",
  "Models": "Модели",
  "Browse and edit models across all providers": "Просмотр и редактирование моделей всех провайдеров",
  "Usage & Analytics": "Использование и аналитика",
  "Auth Files": "Файлы аутентификации",
  "Map provider credentials stored in the local database": "Управление учётными данными провайдеров в локальной БД",
  "Track and manage your API quota limits": "Отслеживание и управление квотами API",
  "MITM Proxy": "MITM Прокси",
  "Token Saver": "Экономия токенов",
  "Compress prompts and outputs to save tokens": "Сжатие промптов и ответов для экономии токенов",
  "Proxy Pools": "Пулы прокси",
  "Manage your proxy pool configurations": "Управление конфигурациями пулов прокси",
  "Agent Skills": "Навыки агента",
  "Copy a link and paste to your AI to use 9Router — no install needed": "Скопируйте ссылку и вставьте в ваш AI для использования 9Router — без установки",
  "Media Providers": "Медиа-провайдеры",
  "Manage your": "Управление",
  "providers": "провайдерами",
};

const ZH = {
  "Active": "已启用",
  "All": "全部",
  "Expand all": "展开全部",
  "Collapse all": "折叠全部",
  "All built-in and custom models across providers.": "所有提供商的内置和自定义模型。",
  "models.dev catalog is unavailable.": "models.dev 目录不可用。",
  "Refreshing...": "刷新中...",
  "Refresh models.dev": "刷新 models.dev",
  "Search by model id, name or alias...": "按模型 ID、名称或别名搜索...",
  "All providers": "所有提供商",
  "No models found.": "未找到模型。",
  "Importing...": "导入中...",
  "Import from models.dev": "从 models.dev 导入",
  "Edit model": "编辑模型",
  "Enable model": "启用模型",
  "Disable model": "禁用模型",
  "Delete custom model": "删除模型",
  "Delete Custom Model": "删除模型",
  "Alias": "别名",
  "Friendly name for routing": "路由友好名称",
  "Capabilities": "功能",
  "Reset to defaults": "重置为默认值",
  "Context window (tokens)": "上下文窗口 (tokens)",
  "Max output (tokens)": "最大输出 (tokens)",
  "Pricing": "定价",
  "($ per 1M tokens, empty = unset)": "($ / 1M tokens，留空 = 未设置)",
  "Vision (image input)": "视觉 (图像输入)",
  "Reasoning / thinking": "推理 / 思考",
  "Tool calling": "工具调用",
  "PDF input": "PDF 输入",
  "Image output": "图像输出",
  "Audio input": "音频输入",
  "Input": "输入",
  "Output": "输出",
  "Cached input": "缓存输入",
  "Cache creation": "缓存写入",
  "Import Models from Provider": "从提供商导入模型",
  "Done": "完成",
  "Fetching models from provider...": "正在获取提供商模型...",
  "Search models...": "搜索模型...",
  "Select All": "全选",
  "No models match the search": "没有匹配搜索的模型",
  "added": "已添加",
  "Provider returned 0 models": "提供商返回 0 个模型",
  "Model ID": "模型 ID",
  "Adding...": "添加中...",
  "Import from /models": "从 /models 导入",
  "Set a Base URL on the active connection to enable importing models.": "在活动连接上设置 Base URL 以启用模型导入。",
  "Add a connection to enable importing models.": "添加连接以启用模型导入。",
  "Remove model": "删除模型",
  "Copied!": "已复制！",
  "Testing...": "测试中...",
  "Test": "测试",
  "Add Custom Model": "添加模型",
  "Remove custom model": "删除模型",
  "FREE": "免费",
  "Models": "模型",
  "Browse and edit models across all providers": "浏览和编辑所有提供商的模型",
};

const files = readdirSync(LITERALS_DIR).filter((f) => f.endsWith(".json"));

let addedTotal = 0;

for (const file of files) {
  const path = `${LITERALS_DIR}/${file}`;
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const locale = file.replace(".json", "");
  let added = 0;

  for (const key of NEW_KEYS) {
    if (data[key] !== undefined) continue;
    if (locale === "ru") {
      data[key] = RU[key] || key;
    } else if (locale === "zh-CN" || locale === "zh-TW") {
      data[key] = ZH[key] || key;
    } else {
      data[key] = key; // fallback: English value
    }
    added++;
  }

  if (added > 0) {
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    console.log(`${file}: +${added} keys`);
    addedTotal += added;
  }
}

console.log(`\nTotal: ${addedTotal} keys added across ${files.length} files`);

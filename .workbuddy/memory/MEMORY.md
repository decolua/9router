# 9Router 项目记忆

## i18n / 国际化翻译

9Router 使用自研的**浏览器端运行时翻译**方案，而不是 next-intl 之类的库。

- **翻译字典**：`public/i18n/literals/<locale>.json`，共 34 个非英文语言文件，格式为扁平 `{ "英文原文": "译文" }`。`en` 为默认原文，无对应文件。
- **语言配置**：`src/i18n/config.js` — 定义 `LOCALES`、`DEFAULT_LOCALE="en"`、`LOCALE_COOKIE="locale"`、`LOCALE_NAMES`、规范化函数。
- **运行时引擎**：`src/i18n/runtime.js` — 读取 cookie 中的 locale，fetch 对应 JSON，用 MutationObserver 遍历并替换 DOM 文本节点。组件也可显式导入 `translate(text)`。
- **Provider 挂载**：`src/i18n/RuntimeI18nProvider.js` 在 `src/app/layout.js` 顶层包裹。
- **切换 UI**：`src/shared/components/LanguageSwitcher.js`，切换时调用 `POST /api/locale`（`src/app/api/locale/route.js`）写入 cookie。
- **注意**：根目录 `i18n/` 只是 README 的多语言副本，与 UI 翻译无关。

如需新增/修改某语言文案，直接编辑 `public/i18n/literals/<locale>.json`，按已有扁平字典格式新增键值对即可。key 必须是组件中渲染的英文原文（含空格与符号），保存后刷新页面生效。

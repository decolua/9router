import { DEFAULT_LANG } from "./languages";

// Navigation structure (slugs are shared). Labels are per-language.
const NAV_STRUCTURE = [
  {
    key: "gettingStarted",
    items: [
      { key: "introduction", slug: "" },
      { key: "quickStart", slug: "getting-started/quick-start" },
      { key: "installation", slug: "getting-started/installation" }
    ]
  },
  {
    key: "providers",
    items: [
      { key: "subscription", slug: "providers/subscription" },
      { key: "cheap", slug: "providers/cheap" },
      { key: "free", slug: "providers/free" }
    ]
  },
  {
    key: "features",
    items: [
      { key: "smartRouting", slug: "features/smart-routing" },
      { key: "combos", slug: "features/combos" },
      { key: "quotaTracking", slug: "features/quota-tracking" }
    ]
  },
  {
    key: "integration",
    items: [
      { key: "claudeCode", slug: "integration/claude-code" },
      { key: "codex", slug: "integration/codex" },
      { key: "cursor", slug: "integration/cursor" },
      { key: "cline", slug: "integration/cline" },
      { key: "roo", slug: "integration/roo" },
      { key: "continue", slug: "integration/continue" },
      { key: "otherTools", slug: "integration/other-tools" }
    ]
  },
  {
    key: "deployment",
    items: [
      { key: "localhost", slug: "deployment/localhost" },
      { key: "cloud", slug: "deployment/cloud" }
    ]
  },
  {
    key: "help",
    items: [
      { key: "troubleshooting", slug: "troubleshooting" },
      { key: "faq", slug: "faq" }
    ]
  }
];

// Translations for section/item titles (5 langs).
const TRANSLATIONS = {
  en: {
    gettingStarted: "Getting Started",
    introduction: "Introduction",
    quickStart: "Quick Start",
    installation: "Installation",
    providers: "Providers",
    subscription: "Subscription (Maximize)",
    cheap: "Cheap (Backup)",
    free: "Free (Fallback)",
    features: "Features",
    smartRouting: "Smart Routing",
    combos: "Combos & Fallback",
    quotaTracking: "Quota Tracking",
    integration: "Integration",
    claudeCode: "Claude Code",
    codex: "OpenAI Codex",
    cursor: "Cursor",
    cline: "Cline",
    roo: "Roo",
    continue: "Continue",
    otherTools: "Other Tools",
    deployment: "Deployment",
    localhost: "Localhost",
    cloud: "Cloud (VPS/Docker)",
    help: "Help",
    troubleshooting: "Troubleshooting",
    faq: "FAQ",
    goToApp: "Go to App",
    selectLanguage: "Select Language",
    onThisPage: "On this page"
  },
  vi: {
    gettingStarted: "Bắt đầu",
    introduction: "Giới thiệu",
    quickStart: "Bắt đầu nhanh",
    installation: "Cài đặt",
    providers: "Nhà cung cấp",
    subscription: "Subscription (Tối đa hóa)",
    cheap: "Giá rẻ (Dự phòng)",
    free: "Miễn phí (Phương án cuối)",
    features: "Tính năng",
    smartRouting: "Định tuyến thông minh",
    combos: "Combo & Fallback",
    quotaTracking: "Theo dõi Quota",
    integration: "Tích hợp",
    claudeCode: "Claude Code",
    codex: "OpenAI Codex",
    cursor: "Cursor",
    cline: "Cline",
    roo: "Roo",
    continue: "Continue",
    otherTools: "Công cụ khác",
    deployment: "Triển khai",
    localhost: "Localhost",
    cloud: "Cloud (VPS/Docker)",
    help: "Trợ giúp",
    troubleshooting: "Khắc phục sự cố",
    faq: "Câu hỏi thường gặp",
    goToApp: "Vào ứng dụng",
    selectLanguage: "Chọn ngôn ngữ",
    onThisPage: "Trên trang này"
  },
  "zh-CN": {
    gettingStarted: "开始使用",
    introduction: "简介",
    quickStart: "快速开始",
    installation: "安装",
    providers: "提供商",
    subscription: "订阅 (最大化)",
    cheap: "低价 (备用)",
    free: "免费 (兜底)",
    features: "功能",
    smartRouting: "智能路由",
    combos: "组合与回退",
    quotaTracking: "配额跟踪",
    integration: "集成",
    claudeCode: "Claude Code",
    codex: "OpenAI Codex",
    cursor: "Cursor",
    cline: "Cline",
    roo: "Roo",
    continue: "Continue",
    otherTools: "其他工具",
    deployment: "部署",
    localhost: "本地",
    cloud: "云端 (VPS/Docker)",
    help: "帮助",
    troubleshooting: "故障排查",
    faq: "常见问题",
    goToApp: "前往应用",
    selectLanguage: "选择语言",
    onThisPage: "本页内容"
  },
  es: {
    gettingStarted: "Comenzar",
    introduction: "Introducción",
    quickStart: "Inicio rápido",
    installation: "Instalación",
    providers: "Proveedores",
    subscription: "Suscripción (Maximizar)",
    cheap: "Económico (Respaldo)",
    free: "Gratis (Alternativa)",
    features: "Funciones",
    smartRouting: "Enrutamiento inteligente",
    combos: "Combos y Fallback",
    quotaTracking: "Seguimiento de cuota",
    integration: "Integración",
    claudeCode: "Claude Code",
    codex: "OpenAI Codex",
    cursor: "Cursor",
    cline: "Cline",
    roo: "Roo",
    continue: "Continue",
    otherTools: "Otras herramientas",
    deployment: "Despliegue",
    localhost: "Localhost",
    cloud: "Nube (VPS/Docker)",
    help: "Ayuda",
    troubleshooting: "Solución de problemas",
    faq: "Preguntas frecuentes",
    goToApp: "Ir a la app",
    selectLanguage: "Seleccionar idioma",
    onThisPage: "En esta página"
  },
  ja: {
    gettingStarted: "はじめに",
    introduction: "概要",
    quickStart: "クイックスタート",
    installation: "インストール",
    providers: "プロバイダー",
    subscription: "サブスクリプション (最大化)",
    cheap: "格安 (バックアップ)",
    free: "無料 (フォールバック)",
    features: "機能",
    smartRouting: "スマートルーティング",
    combos: "コンボとフォールバック",
    quotaTracking: "クォータ追跡",
    integration: "連携",
    claudeCode: "Claude Code",
    codex: "OpenAI Codex",
    cursor: "Cursor",
    cline: "Cline",
    roo: "Roo",
    continue: "Continue",
    otherTools: "その他のツール",
    deployment: "デプロイ",
    localhost: "ローカル",
    cloud: "クラウド (VPS/Docker)",
    help: "ヘルプ",
    troubleshooting: "トラブルシューティング",
    faq: "よくある質問",
    goToApp: "アプリへ",
    selectLanguage: "言語を選択",
    onThisPage: "このページ"
  }
};

// Translate one key for given language with fallback to default.
export function t(lang, key) {
  return TRANSLATIONS[lang]?.[key] || TRANSLATIONS[DEFAULT_LANG][key] || key;
}

// Build localized navigation for sidebar.
export function getNavigation(lang) {
  return NAV_STRUCTURE.map(section => ({
    key: section.key,
    title: t(lang, section.key),
    items: section.items.map(item => ({
      key: item.key,
      slug: item.slug,
      title: t(lang, item.key)
    }))
  }));
}

// Static config (logo, urls, default English nav for backward compatibility).
export const DOCS_CONFIG = {
  title: "9Router Documentation",
  description: "Smart AI model router - Maximize subscriptions, minimize costs",
  logo: "9Router",
  appUrl: "https://9router.com",
  githubUrl: "https://github.com/decolua/9router",
  navigation: getNavigation(DEFAULT_LANG)
};

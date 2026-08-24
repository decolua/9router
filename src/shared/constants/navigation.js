export const NAVIGATION_VISIBILITY_OPTIONS = [
  { id: "dashboard", label: "仪表盘", section: "主要功能" },
  { id: "monitor", label: "系统监控", section: "系统" },
  { id: "endpoint", label: "端点与密钥", section: "主要功能" },
  { id: "model-market", label: "模型广场", section: "主要功能" },
  { id: "key-groups", label: "密钥分组", section: "主要功能" },
  { id: "providers", label: "提供商", section: "主要功能" },
  { id: "combos", label: "模型组合", section: "主要功能" },
  { id: "expert-panel", label: "专家团会话", section: "主要功能" },
  { id: "token-saver", label: "Token 节省", section: "主要功能" },
  { id: "cli-tools", label: "CLI 工具", section: "主要功能" },
  { id: "usage", label: "流量分析", section: "成本中心" },
  { id: "traffic-logs", label: "流量日志", section: "成本中心" },
  { id: "pricing", label: "模型定价", section: "成本中心" },
  { id: "model-mappings", label: "模型映射", section: "成本中心" },
  { id: "media-providers", label: "媒体提供商", section: "系统" },
  { id: "proxy-pools", label: "代理池", section: "系统" },
  { id: "skills", label: "技能", section: "系统" },
  { id: "console-log", label: "控制台日志", section: "系统" },
  { id: "translator", label: "转换器", section: "系统" },
  { id: "remote", label: "9Remote", section: "系统" },
  { id: "english", label: "9English", section: "系统" },
];

export const DEFAULT_NAVIGATION_SECTIONS = ["主要功能", "成本中心", "系统"];

export const DEFAULT_NAVIGATION_ITEM_ORDER = [
  "dashboard", "endpoint", "model-market", "key-groups", "providers", "combos",
  "expert-panel", "token-saver", "cli-tools", "usage", "traffic-logs", "pricing",
  "model-mappings", "monitor", "proxy-pools", "skills", "console-log", "translator",
  "media-providers", "remote", "english",
];

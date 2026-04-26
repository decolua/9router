export interface Settings {
  fallbackStrategy: string;
  outboundProxyEnabled: boolean;
  outboundProxyUrl: string;
  outboundNoProxy: string;
  requireLogin: boolean;
  hasPassword?: boolean;
  enableObservability: boolean;
  enableRtk?: boolean;
  stickyRoundRobinLimit: number;
  comboStrategy: string;
  tunnelUrl?: string;
  tailscaleUrl?: string;
  password?: string;
}

export type Status = { type: string; message: string };

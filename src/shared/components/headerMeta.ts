import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";

export interface HeaderBreadcrumb {
  label: string;
  href?: string;
  isCurrent?: boolean;
}

export interface HeaderMeta {
  breadcrumbs: HeaderBreadcrumb[];
}

const STATIC_ROUTE_LABELS: Record<string, string> = {
  "/dashboard/providers": "Nhà cung cấp",
  "/dashboard/combos": "Kết hợp",
  "/dashboard/usage": "Mức sử dụng",
  "/dashboard/quota": "Theo dõi quota",
  "/dashboard/mitm": "MITM Proxy",
  "/dashboard/cli-tools": "Công cụ CLI",
  "/dashboard/proxy-pools": "Cụm proxy",
  "/dashboard/endpoint": "Endpoint",
  "/dashboard/profile": "Cài đặt",
  "/dashboard/translator": "Dịch thuật",
  "/dashboard/console-log": "Nhật ký console",
  "/dashboard": "Bảng điều khiển",
};

export function resolveHeaderMeta(pathname: string): HeaderMeta {
  if (!pathname) {
    return {
      breadcrumbs: [{ label: "Bảng điều khiển", href: "/dashboard", isCurrent: true }],
    };
  }

  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = (AI_PROVIDERS as Record<string, { name?: string }>)[providerId];

    return {
      breadcrumbs: [
        { label: "Bảng điều khiển", href: "/dashboard" },
        { label: "Nhà cung cấp media", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId, isCurrent: true },
      ],
    };
  }

  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);

    return {
      breadcrumbs: [
        { label: "Bảng điều khiển", href: "/dashboard" },
        { label: "Nhà cung cấp media", href: "/dashboard/media-providers" },
        { label: kindConfig?.label || kindId, isCurrent: true },
      ],
    };
  }

  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      (OAUTH_PROVIDERS as Record<string, { name?: string }>)[providerId] ||
      (APIKEY_PROVIDERS as Record<string, { name?: string }>)[providerId];

    if (providerInfo) {
      return {
        breadcrumbs: [
          { label: "Bảng điều khiển", href: "/dashboard" },
          { label: "Nhà cung cấp", href: "/dashboard/providers" },
          { label: providerInfo.name || providerId, isCurrent: true },
        ],
      };
    }
  }

  const currentLabel =
    STATIC_ROUTE_LABELS[pathname] ||
    STATIC_ROUTE_LABELS["/dashboard" + pathname.replace("/dashboard", "")] ||
    "Bảng điều khiển";

  return {
    breadcrumbs: [
      { label: "Bảng điều khiển", href: "/dashboard", isCurrent: pathname === "/dashboard" },
      ...(pathname === "/dashboard" ? [] : [{ label: currentLabel, isCurrent: true }]),
    ],
  };
}

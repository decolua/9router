"use client";

import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { Card } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const { copied, copy } = useCopyToClipboard();

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const endpointText = `${kindConfig.endpoint.method} ${kindConfig.endpoint.path}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Endpoint block */}
      <Card padding="sm">
        <p className="text-xs text-text-muted uppercase tracking-wider mb-2 font-semibold">Endpoint</p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
            {kindConfig.endpoint.method}
          </span>
          <code className="text-sm font-mono text-text-main flex-1">{kindConfig.endpoint.path}</code>
          <button
            onClick={() => copy(endpointText)}
            className="text-text-muted hover:text-text-main transition-colors"
            title="Copy endpoint"
          >
            <span className="material-symbols-outlined text-[18px]">
              {copied ? "check" : "content_copy"}
            </span>
          </button>
        </div>
      </Card>

      {/* Provider list */}
      {providers.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-text-muted text-sm">
          No providers support <strong>{kindConfig.label}</strong> yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {providers.map((provider) => (
            <Link key={provider.id} href={`/dashboard/media-providers/${kind}/${provider.id}`}>
              <Card padding="xs" className="h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div
                    className="size-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${provider.color?.length > 7 ? provider.color : (provider.color ?? "#888") + "15"}` }}
                  >
                    <ProviderIcon
                      src={`/providers/${provider.id}.png`}
                      alt={provider.name}
                      size={30}
                      className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                      fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                      fallbackColor={provider.color}
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{provider.name}</p>
                    <p className="text-xs text-text-muted">{(provider.serviceKinds ?? ["llm"]).join(", ")}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

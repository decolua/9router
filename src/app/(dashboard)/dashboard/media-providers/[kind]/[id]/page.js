"use client";

import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Card, Badge } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";

export default function MediaProviderDetailPage() {
  const { kind, id } = useParams();
  const { copied, copy } = useCopyToClipboard();
  const [headerImgError, setHeaderImgError] = useState(false);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  if (!kindConfig) return notFound();

  const provider = AI_PROVIDERS[id];
  if (!provider) return notFound();

  const kinds = provider.serviceKinds ?? ["llm"];
  if (!kinds.includes(kind)) return notFound();

  const endpointText = `${kindConfig.endpoint.method} ${kindConfig.endpoint.path}`;

  return (
    <div className="flex flex-col gap-8">
      {/* Back */}
      <div>
        <Link
          href={`/dashboard/media-providers/${kind}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {kindConfig.label}
        </Link>

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="rounded-lg flex items-center justify-center" style={{ backgroundColor: `${provider.color}15` }}>
            {headerImgError ? (
              <span className="size-12 flex items-center justify-center text-sm font-bold rounded-lg" style={{ color: provider.color }}>
                {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                width={48} height={48}
                className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{provider.name}</h1>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {kinds.map((k) => (
                <Badge key={k} variant={k === kind ? "primary" : "default"} size="sm">
                  {k.toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Endpoint block */}
      <Card padding="sm">
        <p className="text-xs text-text-muted uppercase tracking-wider mb-2 font-semibold">{kindConfig.label} Endpoint</p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
            {kindConfig.endpoint.method}
          </span>
          <code className="text-sm font-mono text-text-main flex-1">{kindConfig.endpoint.path}</code>
          <button onClick={() => copy(endpointText)} className="text-text-muted hover:text-text-main transition-colors" title="Copy">
            <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "content_copy"}</span>
          </button>
        </div>
      </Card>

      {/* Connections — reuse shared component */}
      <ConnectionsCard providerId={id} isOAuth={false} />

      {/* Models — filtered by current kind */}
      <ModelsCard providerId={id} kindFilter={kind} />
    </div>
  );
}

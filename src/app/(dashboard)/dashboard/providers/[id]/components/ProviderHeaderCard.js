import Link from "next/link";
import Image from "next/image";

export default function ProviderHeaderCard({
  providerInfo,
  connectionsCount,
  headerImgError,
  onHeaderImgError,
  getHeaderIconPath,
}) {
  return (
    <div className="min-w-0">
      <Link
        href="/dashboard/providers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-primary"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to Providers
      </Link>
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${providerInfo.color}15` }}
        >
          {headerImgError ? (
            <span
              className="text-sm font-bold"
              style={{ color: providerInfo.color }}
            >
              {providerInfo.textIcon ||
                providerInfo.id.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <Image
              src={getHeaderIconPath()}
              alt={providerInfo.name}
              width={48}
              height={48}
              className="max-h-12 max-w-12 rounded-lg object-contain"
              sizes="48px"
              onError={onHeaderImgError}
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {providerInfo.name}
            </h1>
            {(providerInfo.notice?.apiKeyUrl ||
              providerInfo.notice?.signupUrl ||
              providerInfo.website) && (
              <a
                href={
                  providerInfo.notice?.apiKeyUrl ||
                  providerInfo.notice?.signupUrl ||
                  providerInfo.website
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-sm">
                  open_in_new
                </span>
                {providerInfo.notice?.apiKeyUrl
                  ? "Get API Key"
                  : "Sign up / Learn more"}
              </a>
            )}
          </div>
          <p className="text-text-muted">
            {connectionsCount} connection{connectionsCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

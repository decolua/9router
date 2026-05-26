export default function ProviderNoticeBanner({ providerInfo }) {
  if (providerInfo.deprecated) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-yellow-500">
          warning
        </span>
        <p className="text-xs leading-relaxed text-red-600 dark:text-yellow-400">
          {providerInfo.deprecationNotice}
        </p>
      </div>
    );
  }

  if (!providerInfo.notice?.text) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
      <span className="material-symbols-outlined shrink-0 text-[16px] text-blue-500">
        info
      </span>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">
        {providerInfo.notice.text}
      </p>
      {providerInfo.notice.apiKeyUrl && (
        <a
          href={providerInfo.notice.apiKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
        >
          Get API Key →
        </a>
      )}
    </div>
  );
}

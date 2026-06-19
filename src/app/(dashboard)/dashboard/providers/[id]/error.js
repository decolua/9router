"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function ProviderDetailError({ error, reset }) {
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    console.error("Provider detail page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-sm text-text-muted mb-4">
          This provider page failed to load. This may happen during hydration
          in production builds.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            href="/dashboard/providers"
            className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-surface-2"
          >
            Back to Providers
          </Link>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="px-4 py-2 text-xs text-text-muted hover:text-text-main"
          >
            Debug
          </button>
        </div>
      </div>
      {showDebug && (
        <div className="w-full max-w-2xl p-4 bg-surface-2 rounded-lg overflow-auto">
          <p className="text-xs font-mono whitespace-pre-wrap break-all">
            {error?.message}
          </p>
          <p className="text-xs font-mono whitespace-pre-wrap break-all mt-2">
            {error?.stack}
          </p>
        </div>
      )}
    </div>
  );
}

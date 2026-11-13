"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function CombosError({ error, reset }) {
  useEffect(() => {
    console.error("Combos page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="material-symbols-outlined text-4xl text-orange-500">
        warning
      </span>
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="max-w-md text-sm text-text-muted">
        The combos page failed to load. This may happen during hydration in
        production builds.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
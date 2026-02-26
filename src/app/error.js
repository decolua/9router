"use client";

import { useEffect } from "react";
import { Button, Card } from "@/shared/components";

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error("App route error boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-red-500">
            <span className="material-symbols-outlined">error</span>
            <h2 className="text-xl font-semibold text-text-main">Something went wrong</h2>
          </div>

          <p className="text-sm text-text-muted">
            An unexpected error occurred while rendering this page.
          </p>

          <div className="flex gap-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.assign("/dashboard")}
            >
              Go to dashboard
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

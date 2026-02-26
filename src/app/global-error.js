"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("Global app error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif",
            background: "#FBF9F6",
            color: "#383733",
          }}
        >
          <div
            style={{
              maxWidth: "560px",
              width: "100%",
              background: "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02), 0 4px 12px rgba(0, 0, 0, 0.015)",
            }}
          >
            <h2 style={{ margin: 0, marginBottom: "8px", fontSize: "20px" }}>Critical application error</h2>
            <p style={{ margin: 0, marginBottom: "16px", color: "#75736E", fontSize: "14px" }}>
              A critical error prevented the app shell from loading.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                border: "none",
                borderRadius: "8px",
                padding: "10px 14px",
                cursor: "pointer",
                color: "#fff",
                background: "#D97757",
                fontWeight: 600,
              }}
            >
              Try recovery
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

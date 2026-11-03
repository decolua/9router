// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PlaygroundInspector from "@/app/(dashboard)/dashboard/playground/components/PlaygroundInspector.jsx";

describe("PlaygroundInspector", () => {
  it("renders client-visible result fields while redacting unsafe request and response details", () => {
    const { container } = render(
      <PlaygroundInspector
        data={{
          request: {
            model: "safe/model",
            messages: [{ role: "user", content: "Explain the result" }],
            authorization: "Bearer sk-secret-value",
            providerSpecificData: { token: "session-secret" },
            image: { dataUrl: "data:image/png;base64,raw-image-payload" },
            callback: "https://user:password@example.com/?token=secret",
          },
          response: {
            status: 200,
            output: "Safe normalized output",
            rawProviderPayload: "provider-private-value",
          },
          metrics: {
            durationMs: 120,
            ttftMs: 30,
            usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
            terminalState: "complete",
            costUsd: 99,
          },
        }}
      />,
    );

    const inspector = screen.getByTestId("playground-inspector");
    expect(inspector.textContent).toContain("safe/model");
    expect(inspector.textContent).toContain("HTTP 200");
    expect(inspector.textContent).toContain("120ms");
    expect(inspector.textContent).toContain("30ms");
    expect(inspector.textContent).toContain("12");
    expect(inspector.textContent).toContain("complete");
    expect(inspector.textContent).toContain("Safe normalized output");
    expect(inspector.textContent).not.toContain("Cost");

    const rendered = container.textContent;
    expect(rendered).not.toContain("sk-secret-value");
    expect(rendered).not.toContain("session-secret");
    expect(rendered).not.toContain("raw-image-payload");
    expect(rendered).not.toContain("user:password");
    expect(rendered).not.toContain("provider-private-value");
  });

  it("marks usage unavailable when the normalized metrics have no authoritative usage", () => {
    render(<PlaygroundInspector data={{ request: { model: "safe/model" }, response: {}, metrics: {} }} />);

    expect(screen.getByTestId("playground-inspector").textContent).toContain("Unavailable");
  });
});

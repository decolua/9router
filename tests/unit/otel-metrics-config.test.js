// OpenTelemetry usage metrics: pure config parsing + /metrics auth check.
import { describe, it, expect } from "vitest";
import { parseMetricsConfig, checkMetricsAuth } from "@/lib/observability/metricsConfig.js";

const basic = (user, pw) => "Basic " + Buffer.from(`${user}:${pw}`).toString("base64");

describe("parseMetricsConfig", () => {
  it("is fully off with an empty environment", () => {
    const cfg = parseMetricsConfig({});
    expect(cfg.otlp.enabled).toBe(false);
    expect(cfg.prometheus.enabled).toBe(false);
    expect(cfg.prometheus.password).toBe("");
    expect(cfg.serviceName).toBe("9router");
    expect(cfg.otlp.intervalMs).toBe(60000);
    expect(cfg.enabled).toBe(false);
  });

  it("enables OTLP push from either endpoint variable", () => {
    expect(parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x:4318" }).otlp.enabled).toBe(true);
    expect(parseMetricsConfig({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://x:4318/v1/metrics" }).otlp.enabled).toBe(true);
    expect(parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x" }).enabled).toBe(true);
  });

  it("ignores blank endpoints", () => {
    expect(parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " }).otlp.enabled).toBe(false);
  });

  it("OTEL_METRICS_EXPORTER=none switches OTLP off", () => {
    const cfg = parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", OTEL_METRICS_EXPORTER: "none" });
    expect(cfg.otlp.enabled).toBe(false);
    const cfg2 = parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", OTEL_METRICS_EXPORTER: " NONE " });
    expect(cfg2.otlp.enabled).toBe(false);
    const cfg3 = parseMetricsConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", OTEL_METRICS_EXPORTER: "otlp" });
    expect(cfg3.otlp.enabled).toBe(true);
  });

  it("reads the export interval and timeout, falling back on junk", () => {
    expect(parseMetricsConfig({ OTEL_METRIC_EXPORT_INTERVAL: "15000" }).otlp.intervalMs).toBe(15000);
    expect(parseMetricsConfig({ OTEL_METRIC_EXPORT_INTERVAL: "abc" }).otlp.intervalMs).toBe(60000);
    expect(parseMetricsConfig({ OTEL_METRIC_EXPORT_INTERVAL: "0" }).otlp.intervalMs).toBe(60000);
    expect(parseMetricsConfig({}).otlp.timeoutMs).toBe(30000);
    // Timeout may never exceed the interval (the SDK rejects that).
    expect(parseMetricsConfig({ OTEL_METRIC_EXPORT_INTERVAL: "5000" }).otlp.timeoutMs).toBe(5000);
    expect(parseMetricsConfig({ OTEL_METRIC_EXPORT_INTERVAL: "5000", OTEL_METRIC_EXPORT_TIMEOUT: "1000" }).otlp.timeoutMs).toBe(1000);
  });

  it("reads the service name", () => {
    expect(parseMetricsConfig({ OTEL_SERVICE_NAME: "my-router" }).serviceName).toBe("my-router");
    expect(parseMetricsConfig({ OTEL_SERVICE_NAME: "" }).serviceName).toBe("9router");
  });

  it("parses the Prometheus endpoint switch and password", () => {
    for (const v of ["true", "1", "yes", "on", "TRUE"]) {
      expect(parseMetricsConfig({ OBSERVABILITY_METRICS_ENDPOINT_ENABLED: v }).prometheus.enabled).toBe(true);
    }
    for (const v of ["false", "0", "", "nope", undefined]) {
      expect(parseMetricsConfig({ OBSERVABILITY_METRICS_ENDPOINT_ENABLED: v }).prometheus.enabled).toBe(false);
    }
    const cfg = parseMetricsConfig({ OBSERVABILITY_METRICS_ENDPOINT_ENABLED: "true", OBSERVABILITY_METRICS_ENDPOINT_PASSWORD: "pw" });
    expect(cfg.prometheus.password).toBe("pw");
    expect(cfg.enabled).toBe(true);
  });
});

describe("checkMetricsAuth", () => {
  it("allows everything when no password is set", () => {
    expect(checkMetricsAuth(null, "")).toBe(true);
    expect(checkMetricsAuth("Bearer whatever", "")).toBe(true);
  });

  it("requires credentials when a password is set", () => {
    expect(checkMetricsAuth(null, "s3cret")).toBe(false);
    expect(checkMetricsAuth("", "s3cret")).toBe(false);
  });

  it("accepts Bearer <password>", () => {
    expect(checkMetricsAuth("Bearer s3cret", "s3cret")).toBe(true);
    expect(checkMetricsAuth("bearer s3cret", "s3cret")).toBe(true);
    expect(checkMetricsAuth("Bearer wrong", "s3cret")).toBe(false);
    expect(checkMetricsAuth("Bearer s3cret-longer", "s3cret")).toBe(false);
  });

  it("accepts Basic with any username and the password", () => {
    expect(checkMetricsAuth(basic("prometheus", "s3cret"), "s3cret")).toBe(true);
    expect(checkMetricsAuth(basic("", "s3cret"), "s3cret")).toBe(true);
    expect(checkMetricsAuth(basic("x", "pa:ss"), "pa:ss")).toBe(true);
    expect(checkMetricsAuth(basic("prometheus", "wrong"), "s3cret")).toBe(false);
    expect(checkMetricsAuth("Basic !!!notbase64", "s3cret")).toBe(false);
    expect(checkMetricsAuth("Basic " + Buffer.from("nocolon").toString("base64"), "s3cret")).toBe(false);
  });

  it("rejects unknown schemes", () => {
    expect(checkMetricsAuth("Token s3cret", "s3cret")).toBe(false);
    expect(checkMetricsAuth("s3cret", "s3cret")).toBe(false);
  });
});

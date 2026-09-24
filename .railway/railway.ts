import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("9router-data", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 500,
  });

  const app = service("9router", {
    source: github("eladrave/9router", {
      branch: "codex/codex-live-model-discovery",
    }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyMaxRetries: 3, sleepApplication: true },
    volumeMounts: { "/app/data": data },
    env: {
      API_KEY_SECRET: preserve(),
      AUTH_COOKIE_SECURE: "true",
      BASE_URL: preserve(),
      DATA_DIR: "/app/data",
      INITIAL_PASSWORD: preserve(),
      JWT_SECRET: preserve(),
      MACHINE_ID_SALT: preserve(),
      NEXT_PUBLIC_BASE_URL: preserve(),
      NODE_ENV: "production",
      PORT: "20128",
    },
  });

  return project("9router", { resources: [app, data] });
});

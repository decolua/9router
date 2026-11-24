# Agent 01 — Frontier AI Environment

This is a **GPU-ready deployment and secure routing environment**, not a newly trained model or proof of leading benchmark performance. A control plane on Vercel only; the actual model lives on user-owned or rented NVIDIA GPU machines.

## Architecture
- Vercel status dashboard and bearer-protected OpenAI-compatible gateway.
- GPU cluster running official `vllm/vllm-openai` server.
- Suggested open-weight starting point: `Qwen/Qwen3-235B-A22B-Instruct-2507` (Apache-2.0; about 470GB full model weights). For 8-way serving use appropriately sized NVIDIA GPUs and fast shared/local cache; evaluate exact GPU memory and KV-cache limits. **No GPU has been provisioned**.
- Docker Compose single-node and Kubernetes NVIDIA GPU manifests.
- Default gateway fails closed if no GPU endpoint is configured. No model calls are fabricated.

## Setup
1. Provision NVIDIA GPU compute (consider 8 × 80GB-class GPUs for the 235B model at constrained context; validate available memory first). This is NOT free.
2. On the GPU machine, install Docker, NVIDIA Container Toolkit, and configure its GPU driver. Run `nvidia-smi` and `docker compose config`.
3. Copy `.env.example` to `.env`, set model config and a long randomly generated `VLLM_API_KEY`, run `docker compose --profile gpu up -d`. The server only binds to loopback on that host; it must not be publicly exposed unprotected.
4. To access from the Vercel gateway, deploy an authenticated HTTPS reverse proxy or private gateway with explicit authorized access; point `FRONTIER_GPU_BASE_URL` at its `https://host/v1` base URL.
5. In Vercel, set `FRONTIER_API_KEY`, `FRONTIER_UPSTREAM_KEY` (same as the GPU-serving key), `FRONTIER_GPU_BASE_URL` and optionally `FRONTIER_MODEL_ID` as encrypted environment variables. Never commit keys. Redeploy.
6. Verify `GET /health`, authenticated `GET /v1/models`, then a low-token authenticated `POST /v1/chat/completions`. Measure output quality, latency, GPU OOM and quota.
7. Run `npm test` for gateway input/security checks. Tests do not replace real GPU/throughput/benchmark validation.

## Example
```bash
curl https://agent01-frontier-environment.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer $FRONTIER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen3-235B-A22B-Instruct-2507","messages":[{"role":"user","content":"Hello"}],"max_tokens":64}'
```

## Scaling / research roadmap
- Inference: single-node tensor parallelism, then multi-node Ray/vLLM or orchestrated independent replicas with a load balancer and node-local models as needed.
- Training: separate GPU clusters, datasets with clear rights, supervised fine-tuning/LoRA first, evaluation harness and reproducible experiments. Frontier pretraining from scratch requires enormous compute and dataset costs, not supplied by these templates.
- Security: explicit owner approval for cloud billing; private networking and TLS; rotate keys; avoid direct public GPU exposure; keep access logs without prompts or token contents.
- Operational status: control plane may be READY before GPU runtime is present; readiness is not intelligence performance.

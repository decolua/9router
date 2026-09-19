Part of #8

## Question

How to decouple local HTTP readiness on `http://127.0.0.1:20128/v1` from Cloudflare tunnel initialization so that local requests succeed within <1 second of process launch, with public tunnel handshake running asynchronously in the background?

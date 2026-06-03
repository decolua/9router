# Docker

Run the local 9Router fork in a container. This workspace is local-only; build and run the image from this repository instead of pulling/publishing external images.

---

## Build local image

```bash
docker build -t 9router .
```

## Run container

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e INITIAL_PASSWORD="change-this-before-exposing" \
  --name 9router \
  9router
```

Open: http://localhost:20128/dashboard

## Security

- This repo is intended for local use. Do not expose the dashboard to the internet unless `INITIAL_PASSWORD` is strong and auth is enabled.
- Provider credentials and OAuth tokens are stored under `$DATA_DIR/db/data.sqlite`; protect the host data directory.
- Use `REQUIRE_API_KEY=true` before exposing `/v1/*` outside localhost.

## Manage container

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router
docker rm -f 9router
```

## Data persistence

Host path: `$HOME/.9router/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite
│   └── backups/
└── ...
```

## Rebuild update

```bash
docker build -t 9router .
docker rm -f 9router
# re-run the container command above
```

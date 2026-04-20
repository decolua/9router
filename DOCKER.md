# Docker

This project ships with a `Dockerfile` for building and running 8Router in a container.

## Build image

```bash
docker build -t 8router .
```

## Start container

```bash
docker run --rm \
  -p 20128:20128 \
  -v "$HOME/.8router:/app/data" \
  -e DATA_DIR=/app/data \
  --name 8router \
  8router
```

The app listens on port `20128` in the container.

## What the volume does

```bash
-v "$HOME/.8router:/app/data" \
-e DATA_DIR=/app/data
```

`8router` stores its database at `path.join(DATA_DIR, "db.json")`.
Without `DATA_DIR`, the app falls back to the current user's home directory (for example `~/.8router/db.json` on macOS/Linux). In the container, set `DATA_DIR=/app/data` so the bind mount is actually used.

With the example above, the database file is:

```text
/app/data/db.json
```

and it is persisted on the host at:

```text
$HOME/.8router/db.json
```

## Stop container

```bash
docker stop 8router
```

## Run in background

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.8router:/app/data" \
  -e DATA_DIR=/app/data \
  --name 8router \
  8router
```

## View logs

```bash
docker logs -f 8router
```

## Optional environment variables

You can override runtime env vars with `-e`.

Example:

```bash
docker run --rm \
  -p 20128:20128 \
  -v "$HOME/.8router:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name 8router \
  8router
```

## Rebuild after code changes

```bash
docker build -t 8router .
```

Then restart the container.

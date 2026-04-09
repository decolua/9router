# Docker

This project ships with a `Dockerfile` for building and running 9Router in a container.

## Build image

```bash
docker build -t 9router .
```

## Start container

```bash
docker run --rm \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  --name 9router \
  9router
```

The app listens on port `20128` in the container.

## What the volume does

```bash
-v "$HOME/.9router:/app/data"
```

This keeps your data outside the container so it survives restarts and image rebuilds.

## Stop container

```bash
docker stop 9router
```

## Run in background

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  --name 9router \
  9router
```

## View logs

```bash
docker logs -f 9router
```

## Optional environment variables

You can override runtime env vars with `-e`.

Example:

```bash
docker run --rm \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name 9router \
  9router
```

## Rebuild after code changes

```bash
docker build -t 9router .
```

Then restart the container.

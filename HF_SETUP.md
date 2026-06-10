# Hugging Face Spaces Setup Guide for 9Router

This branch is configured to run 9Router on Hugging Face Spaces with auto-sync from the upstream repository.

## What Was Changed for HF Compatibility

| Change | Reason |
|--------|--------|
| `README.md` frontmatter | `sdk: docker` + `app_port: 7860` required by HF Spaces |
| `Dockerfile` port | Changed from `20128` → `7860` (HF standard port) |
| `hf-entrypoint.sh` | Auto-detects `SPACE_HOST` and sets `BASE_URL`/`NEXT_PUBLIC_BASE_URL` automatically |
| `.github/workflows/sync-upstream-and-deploy.yml` | Checks upstream every 6 hours and auto-deploys |

## Setup Steps

### 1. Create the Hugging Face Space

1. Go to [huggingface.co/spaces](https://huggingface.co/spaces) → **Create new Space**
2. **Name:** `9router` (or any name you prefer)
3. **SDK:** Select **Docker**
4. **Visibility:** Public or Private (your choice)
5. Click **Create**

### 2. Add HF Token to GitHub Secrets

1. Get a token from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) with **write** role
2. Go to your fork: `github.com/F4bC0d3/9router/settings/secrets/actions`
3. Add secret **Name:** `HF_TOKEN` → paste the token

### 3. Trigger First Deploy

1. Go to **Actions** tab in your fork
2. Select **"Sync Upstream & Deploy to Hugging Face Space"**
3. Click **Run workflow** → choose `huggingface-spaces` branch → **Run workflow**

The workflow will:
- Check for upstream updates (merges them if found)
- Push the `huggingface-spaces` branch to your HF Space as `main`

### 4. Set Optional Environment Variables

Go to your Space's **Settings → Variables and Secrets**:

| Variable | Suggested Value | Required? |
|----------|---------------|-----------|
| `INITIAL_PASSWORD` | Your custom login password | Optional (default: `123456`) |
| `JWT_SECRET` | Random string (e.g. `openssl rand -hex 32`) | Optional (auto-generated) |
| `REQUIRE_API_KEY` | `true` | **Recommended** for public Spaces |

**You do NOT need to set `BASE_URL` or `NEXT_PUBLIC_BASE_URL`** — they are auto-detected from `SPACE_HOST`.

After setting variables, click **Factory Reboot** in Space Settings.

## How Auto-Sync Works

The GitHub Action runs every **6 hours** (or on manual trigger):
1. Fetches upstream `decolua/9router` master branch
2. Compares with your fork's current state
3. If upstream is ahead → merges changes into `huggingface-spaces` branch
4. Force-pushes `huggingface-spaces` → HF Space `main`
5. HF Space automatically rebuilds and restarts on every push

## Accessing Your Space

Once running, visit:
- `https://<your-username>-9router.hf.space/dashboard`
- API endpoint: `https://<your-username>-9router.hf.space/v1`

## Troubleshooting

**Space stuck on "Building"**
- Check the **Logs** tab in your HF Space
- Factory Reboot from Settings if needed

**OAuth callbacks fail (Kiro, GitHub, etc.)**
- Make sure `SPACE_HOST` is set in the environment (HF provides this automatically)
- The `hf-entrypoint.sh` uses it to set `BASE_URL`
- If still failing, manually set `BASE_URL` in Space Settings

**SQLite data lost on rebuild**
- HF Spaces persists files across restarts, but Factory Reset clears everything
- For critical data, export your config from the 9Router dashboard periodically

## Updating Manually

If you want to pull upstream changes immediately without waiting for the 6-hour schedule:
1. Go to Actions tab
2. Run the workflow manually with **workflow_dispatch**

## Alternative: Local Test

```bash
git checkout huggingface-spaces
docker build -t 9router-hf .
docker run -p 7860:7860 -e SPACE_HOST=localhost:7860 9router-hf
```

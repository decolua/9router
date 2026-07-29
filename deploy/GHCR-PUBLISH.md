# Publish ebRouter Docker image to GitHub Container Registry (GHCR)

GHCR is GitHub’s container registry (`ghcr.io`). It is **not** AWS ECR — this project uses GHCR for Docker images tied to your GitHub account/org.

**Image naming convention:**

```text
ghcr.io/YOUR_GITHUB_ORG/ebrouter:<version>
```

Example: `ghcr.io/acmecorp/ebrouter:0.4.56`

---

## Option A — Automatic via GitHub Actions (recommended)

### 1. Push code to GitHub

Your repo must be on GitHub (e.g. `github.com/acmecorp/eb-router`).

### 2. Workflow is already configured

File: `.github/workflows/docker-publish.yml`

- Triggers on tags matching `v*` (e.g. `v0.4.56`)
- Builds `linux/amd64` + `linux/arm64`
- Pushes to `ghcr.io/<github-owner>/ebrouter`

### 3. Create and push a release tag

```powershell
cd C:\Users\nikun\OneDrive\Desktop\eb-router

git add .
git commit -m "Release 0.4.56"
git tag v0.4.56
git push origin main
git push origin v0.4.56
```

### 4. Watch the workflow

GitHub → **Actions** → **Build and Push Docker Image** → confirm green check.

### 5. Find your image

GitHub → your profile/org → **Packages** → **ebrouter**

Or pull locally:

```powershell
docker pull ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
```

### 6. Update client bundle

In `deploy/client/.env.example`:

```env
EBROUTER_IMAGE=ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
```

---

## Option B — Manual push from your PC

Use this for a quick test before setting up CI.

### 1. Create a GitHub Personal Access Token (PAT)

GitHub → **Settings** → **Developer settings** → **Personal access tokens**

- **Classic token:** enable `write:packages`, `read:packages`, `delete:packages` (optional)
- **Fine-grained token:** Packages → Read and write

Copy the token — you will not see it again.

### 2. Log in to GHCR

```powershell
docker login ghcr.io -u YOUR_GITHUB_USERNAME
# Password: paste your PAT (not your GitHub password)
```

### 3. Build and tag

Replace `YOUR_GITHUB_ORG` with your GitHub username or org (lowercase):

```powershell
cd C:\Users\nikun\OneDrive\Desktop\eb-router

$VERSION = "0.4.56"
$ORG = "YOUR_GITHUB_ORG"
$IMAGE = "ghcr.io/$ORG/ebrouter"

docker build -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" .
```

### 4. Push

```powershell
docker push "ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56"
docker push "ghcr.io/YOUR_GITHUB_ORG/ebrouter:latest"
```

### 5. Make the package visible (first time)

After the first push:

1. GitHub → **Packages** → **ebrouter**
2. **Package settings** → **Change visibility** (Public or Private)
3. For private packages: link the repo under **Connect repository**

---

## Public vs private package

| Visibility | Client install |
|------------|----------------|
| **Public** | `docker pull ghcr.io/org/ebrouter:0.4.56` — no login |
| **Private** | Client must `docker login ghcr.io` with a read-only PAT |

### Give clients access to a private image

1. Add them as collaborator on the repo, **or**
2. Create a PAT with `read:packages` and share securely, **or**
3. Use a machine user / deploy token for their server

Client login:

```powershell
docker login ghcr.io -u CLIENT_GITHUB_USER
# Password: PAT with read:packages

cd C:\ebrouter
.\install.ps1
```

---

## Verify the image

```powershell
docker pull ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56

docker run --rm -p 20128:20128 `
  -e DATA_DIR=/app/data `
  -e JWT_SECRET=test `
  -e INITIAL_PASSWORD=test `
  -e API_KEY_SECRET=test `
  -e MACHINE_ID_SALT=test `
  ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
```

Open http://localhost:20128/dashboard

---

## Client deployment after publish

```powershell
# In deploy/client/.env (or .env.example before zipping)
EBROUTER_IMAGE=ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56

cd deploy\client
.\install.ps1
```

Update later:

```powershell
.\update.ps1 -Image "ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.57"
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `denied: permission_denied` | Re-login: `docker login ghcr.io`; PAT needs `write:packages` |
| `manifest unknown` | Tag not pushed yet — check Actions or run `docker push` again |
| Package not listed | First push creates it; check org Packages tab |
| Client cannot pull private image | Client needs `docker login ghcr.io` + `read:packages` PAT |
| Wrong name `9router` | Use `ebrouter` only: `ghcr.io/org/ebrouter:tag` |

---

## Quick reference

```powershell
# Login
docker login ghcr.io -u YOUR_GITHUB_USERNAME

# Build
docker build -t ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56 .

# Push
docker push ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56

# CI alternative
git tag v0.4.56
git push origin v0.4.56
```

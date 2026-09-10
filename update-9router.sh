#!/bin/bash
# =============================================================
# Cập nhật upstream 9Router nhưng giữ patch local độc lập.
# Workflow: local/stream-hardening --rebase--> origin/master
# Chạy trong WSL: chmod +x update-9router.sh && ./update-9router.sh
# =============================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${CYAN}==> $1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

# Resolve from this script, not $HOME, so the script can never update a different checkout.
ROUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$HOME/.9router"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_BACKUP_DIR="$HOME/.9router.backup-$STAMP"
PATCH_BACKUP_DIR="$HOME/.9router-patches/$STAMP"
PATCH_BRANCH="local/stream-hardening"
UPSTREAM_REF="origin/master"

if ! git -C "$ROUTER_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    err "Không tìm thấy Git checkout 9Router tại $ROUTER_DIR."
    exit 1
fi

cd "$ROUTER_DIR"
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$PATCH_BRANCH" ]; then
    err "Đang ở branch '$CURRENT_BRANCH'; update chỉ được chạy trên '$PATCH_BRANCH'."
    err "Chuyển branch: git switch $PATCH_BRANCH"
    exit 1
fi

# Never auto-stash: untracked files may contain local secrets. A dirty tree means
# patch has not been captured in a durable commit yet, so stop before touching refs.
if [ -n "$(git status --porcelain)" ]; then
    err "Working tree đang có thay đổi chưa commit; dừng update để không mất patch."
    err "Kiểm tra: git status --short"
    err "Sau khi test xong, commit patch trên '$PATCH_BRANCH' rồi chạy lại script."
    exit 1
fi

OLD_VERSION="$(git rev-parse --short HEAD)"
OLD_UPSTREAM="$(git rev-parse --short "$UPSTREAM_REF" 2>/dev/null || echo unknown)"
echo "Patch branch: $PATCH_BRANCH"
echo "Commit hiện tại: $OLD_VERSION"
echo "Upstream cache hiện tại: $OLD_UPSTREAM"

# --- Bước 1: Backup database + local patch commits trước update ---
step "Backup database và patch local"
if [ -d "$DB_DIR" ]; then
    cp -r "$DB_DIR" "$DB_BACKUP_DIR"
    echo "Database backup: $DB_BACKUP_DIR"
else
    warn "Không tìm thấy $DB_DIR — bỏ qua database backup."
fi

mkdir -p "$PATCH_BACKUP_DIR"
LOCAL_COMMIT_COUNT="$(git rev-list --count "$UPSTREAM_REF..HEAD")"
if [ "$LOCAL_COMMIT_COUNT" -gt 0 ]; then
    git format-patch --quiet --output-directory "$PATCH_BACKUP_DIR" "$UPSTREAM_REF..HEAD"
    git bundle create "$PATCH_BACKUP_DIR/local-stream-hardening.bundle" "$PATCH_BRANCH"
    echo "Patch backup ($LOCAL_COMMIT_COUNT commit): $PATCH_BACKUP_DIR"
else
    warn "Branch chưa có commit local phía trên $UPSTREAM_REF; không có patch commit để backup."
fi

# --- Bước 2: Fetch upstream rồi replay patch local lên upstream mới ---
step "Fetch origin và rebase patch local lên origin/master"
git fetch --prune origin
NEW_UPSTREAM="$(git rev-parse --short "$UPSTREAM_REF")"

if ! git rebase "$UPSTREAM_REF"; then
    err "Rebase conflict. Patch KHÔNG bị mất; Git đang giữ conflict để xử lý."
    err "Xem conflict: git status"
    err "Tiếp tục: git add <files> && git rebase --continue"
    err "Hủy update: git rebase --abort"
    exit 1
fi

NEW_VERSION="$(git rev-parse --short HEAD)"
if [ "$OLD_UPSTREAM" = "$NEW_UPSTREAM" ]; then
    warn "Upstream không có commit mới; vẫn build lại để xác minh patch."
else
    echo "Upstream: $OLD_UPSTREAM -> $NEW_UPSTREAM"
fi

# --- Bước 3: Dependencies + build ---
step "Cài dependencies"
npm install

step "Build production"
npm run build

# postbuild already copies standalone assets. Keep an explicit sanity check rather
# than deleting/copying source-adjacent directories a second time.
if [ ! -f "$ROUTER_DIR/.next/standalone/server.js" ]; then
    err "Build thiếu .next/standalone/server.js; không restart service."
    exit 1
fi

# --- Bước 4: Restart + health ---
step "Restart 9Router qua PM2"
pm2 restart 9router
pm2 save

step "Kiểm tra health sau restart"
sleep 3
HEALTH="$(curl --fail --silent --show-error http://localhost:20128/api/health 2>/dev/null || echo FAILED)"
MODELS_STATUS="$(curl --output /dev/null --silent --write-out '%{http_code}' http://localhost:20128/v1/models || echo 000)"

if [[ "$HEALTH" == *'"ok":true'* ]] && [[ "$MODELS_STATUS" =~ ^2 ]]; then
    echo -e "${GREEN}=====================================================${NC}"
    echo -e "${GREEN} CẬP NHẬT THÀNH CÔNG${NC}"
    echo -e "${GREEN} Patch branch: $PATCH_BRANCH${NC}"
    echo -e "${GREEN} Commit: $OLD_VERSION -> $NEW_VERSION${NC}"
    echo -e "${GREEN} Upstream: $OLD_UPSTREAM -> $NEW_UPSTREAM${NC}"
    echo -e "${GREEN} /api/health: $HEALTH${NC}"
    echo -e "${GREEN} /v1/models: HTTP $MODELS_STATUS${NC}"
    echo -e "${GREEN} DB backup: $DB_BACKUP_DIR${NC}"
    echo -e "${GREEN} Patch backup: $PATCH_BACKUP_DIR${NC}"
    echo -e "${GREEN}=====================================================${NC}"
else
    echo -e "${RED}=====================================================${NC}"
    echo -e "${RED} CẢNH BÁO: post-update smoke check thất bại${NC}"
    echo -e "${RED} /api/health: $HEALTH${NC}"
    echo -e "${RED} /v1/models: HTTP $MODELS_STATUS${NC}"
    echo -e "${RED} Log: pm2 logs 9router --lines 100 --nostream${NC}"
    echo -e "${RED} Code rollback: git reset --hard $OLD_VERSION (chỉ sau khi đã xác nhận patch backup)${NC}"
    echo -e "${RED} DB backup: $DB_BACKUP_DIR${NC}"
    echo -e "${RED}=====================================================${NC}"
    exit 1
fi

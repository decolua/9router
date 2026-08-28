#!/bin/bash
# 9router 测试实例：源码启动、独立端口、独立 DATA_DIR —— 与生产(20128)完全隔离。
# 用途：改完源码先在这里验证（scripts/smoke-test.mjs），通过后再 /tmp/9router-deploy.sh 发布。
# 用法: scripts/dev-test-server.sh [up|down|restart|status]   (SKIP_BUILD=1 跳过重新 build)
set -euo pipefail

PORT=20129
DATA_DIR=/tmp/9router-test-data
PID_FILE=/tmp/9router-test.pid
LOG_FILE=/tmp/9router-test.log
cd "$(dirname "$0")/.."

pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" 2>/dev/null || true; }
alive() { local p; p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

up() {
  if alive; then echo "already running: pid $(pid) → http://localhost:$PORT"; exit 0; fi
  if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -d .next ]; then
    echo "[1/3] build..."
    npm run build >/dev/null 2>&1
  fi
  echo "[2/3] start standalone on :$PORT (DATA_DIR=$DATA_DIR)"
  mkdir -p "$DATA_DIR"
  DATA_DIR="$DATA_DIR" PORT="$PORT" HOSTNAME=127.0.0.1 nohup node .next/standalone/custom-server.js >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "[3/3] health check..."
  for _ in $(seq 1 30); do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/dashboard" || true)
    if [ "$code" = "200" ]; then
      echo "ok: pid $(pid) → http://localhost:$PORT  (log: $LOG_FILE)"
      exit 0
    fi
    sleep 1
  done
  echo "FAILED health check — log tail:"; tail -20 "$LOG_FILE"; exit 1
}

down() {
  if alive; then local p; p=$(pid); kill "$p" && rm -f "$PID_FILE" && echo "stopped pid $p"; else echo "not running"; fi
}

# 冷拷贝生产数据到测试 DATA_DIR（sqlite3 .backup 在线安全备份，不锁不碰生产文件）。
# 之后 20129 上看到与生产相同的连接/节点/统计数据，任何页面操作只写测试副本。
sync() {
  down >/dev/null 2>&1 || true
  echo "[sync] 生产 DB → ${DATA_DIR}（.backup，只读源）"
  mkdir -p "$DATA_DIR/db"
  sqlite3 "$HOME/.9router/db/data.sqlite" ".backup '$DATA_DIR/db/data.sqlite'"
  rm -f "$DATA_DIR"/db/data.sqlite-wal "$DATA_DIR"/db/data.sqlite-shm
  for f in usage.json log.txt; do
    [ -f "$HOME/.9router/$f" ] && cp "$HOME/.9router/$f" "$DATA_DIR/$f" 2>/dev/null || true
  done
  echo "done. 启动: scripts/dev-test-server.sh up  → http://localhost:${PORT}（密码与生产相同）"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) down || true; up ;;
  sync) sync ;;
  status) if alive; then echo "running: pid $(pid) → http://localhost:$PORT"; else echo "not running"; fi ;;
  *) echo "usage: $0 [up|down|restart|sync|status]"; exit 1 ;;
esac

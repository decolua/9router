#!/bin/bash

# Màu sắc cho output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Hàm lấy IPv4 hiện tại của VM
get_vm_ip() {
    local ip_addr=""

    if command -v ip >/dev/null 2>&1; then
        ip_addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')
    fi

    if [ -z "${ip_addr}" ]; then
        ip_addr=$(hostname -I 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+\./) {print $i; exit}}')
    fi

    echo "${ip_addr}"
}

# Cấu hình
HOST_IP="${HOST_IP:-$(get_vm_ip)}"
HOSTNAME="9router.diepxuan.corp"
SERVICE_NAME="9router-dev"
PROD_SERVICE_NAME="9router"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
HOSTS_MARKER="# ${SERVICE_NAME} managed"

# Hàm kiểm tra quyền root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}❌ Cần quyền root. Chạy với sudo.${NC}"
        exit 1
    fi
}

# Hàm kiểm tra systemd service có tồn tại
service_exists() {
    local service_name=$1
    systemctl list-unit-files "${service_name}.service" --no-legend 2>/dev/null | grep -q .
}

# Hàm stop service production để nhường port cho dev
stop_prod_service() {
    if service_exists "${PROD_SERVICE_NAME}"; then
        systemctl stop "${PROD_SERVICE_NAME}.service" 2>/dev/null || true
        echo -e "${GREEN}✓ Systemd service ${PROD_SERVICE_NAME} stopped${NC}"
    else
        echo -e "${YELLOW}⚠ Systemd service ${PROD_SERVICE_NAME} not found; skip stop${NC}"
    fi
}

# Hàm start lại service production sau khi tắt dev
start_prod_service() {
    if service_exists "${PROD_SERVICE_NAME}"; then
        if systemctl start "${PROD_SERVICE_NAME}.service"; then
            echo -e "${GREEN}✓ Systemd service ${PROD_SERVICE_NAME} started${NC}"
        else
            echo -e "${RED}✗ Failed to start systemd service ${PROD_SERVICE_NAME}${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Systemd service ${PROD_SERVICE_NAME} not found; skip start${NC}"
    fi
}

# Hàm cập nhật /etc/hosts
update_hosts() {
    local action=$1  # "add" hoặc "remove"

    if [ -z "${HOST_IP}" ]; then
        echo -e "${RED}✗ Cannot detect VM IP address${NC}"
        exit 1
    fi

    if [ "$action" = "add" ]; then
        # Chỉ quản lý dòng do 9router-dev tạo, không đụng hostname hệ thống như 127.0.1.1.
        sed -i "\|${HOSTS_MARKER}|d" /etc/hosts
        echo "${HOST_IP}  ${HOSTNAME}  ${HOSTS_MARKER}" >> /etc/hosts
        echo -e "${GREEN}✓ Updated /etc/hosts: ${HOST_IP}  ${HOSTNAME}${NC}"
        if grep -qE "^127\.[0-9.]+[[:space:]].*[[:space:]]${HOSTNAME}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
            echo -e "${YELLOW}⚠ ${HOSTNAME} also exists on a 127.x.x.x hosts line; local resolution may prefer loopback.${NC}"
        fi
    else
        # Chỉ comment dòng do 9router-dev tạo, không comment hostname hệ thống.
        sed -i "s|^\([^#].*${HOSTS_MARKER}\)|# \1|" /etc/hosts
        echo -e "${GREEN}✓ Commented /etc/hosts entry${NC}"
    fi
}

# Hàm quản lý systemd service
manage_service() {
    local action=$1  # "start" hoặc "stop"

    if [ "$action" = "start" ]; then
        # Tạo service file
        cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=9Router Development Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/npm run dev -- --port 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
        chmod 644 "${SERVICE_FILE}"
        systemctl daemon-reload
        systemctl enable "${SERVICE_NAME}.service"
        systemctl start "${SERVICE_NAME}.service"
        echo -e "${GREEN}✓ Systemd service ${SERVICE_NAME} started and enabled${NC}"
    else
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null
        rm -f "${SERVICE_FILE}"
        systemctl daemon-reload
        echo -e "${GREEN}✓ Systemd service ${SERVICE_NAME} stopped, disabled, and removed${NC}"
    fi
}

# Hàm start
do_start() {
    check_root

    echo -e "\n${GREEN}🚀 Starting 9Router development environment...${NC}"

    # Cập nhật hosts
    update_hosts "add"

    # Stop production service để tránh tranh port với dev service
    stop_prod_service

    # Quản lý systemd service
    manage_service "start"

    # Kiểm tra trạng thái
    sleep 2
    if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
        echo -e "\n${GREEN}✅ Development server is running!${NC}"
        echo -e "${YELLOW}🌐 Access: http://${HOSTNAME}:3000${NC}"
        echo -e "${YELLOW}📝 View logs: ./dev.sh logs${NC}"
    else
        echo -e "${RED}❌ Failed to start service. Check logs:${NC}"
        journalctl -u "${SERVICE_NAME}" --no-pager -n 10
        exit 1
    fi
}

# Hàm stop
do_stop() {
    local restart_prod=${1:-yes}
    check_root

    echo -e "\n${YELLOW}🛑 Stopping 9Router development environment...${NC}"

    # Cập nhật hosts (comment)
    update_hosts "remove"

    # Quản lý systemd service
    manage_service "stop"

    if [ "${restart_prod}" = "yes" ]; then
        start_prod_service
    fi

    echo -e "${GREEN}✅ Development environment stopped${NC}"
}

# Hàm logs (realtime)
do_logs() {
    echo -e "${YELLOW}📝 Following logs for ${SERVICE_NAME}... (Ctrl+C to exit)${NC}"
    echo "================================"
    journalctl -u "${SERVICE_NAME}" -f --no-pager
}

# Hàm status
do_status() {
    echo -e "\n${YELLOW}📊 9Router Development Status${NC}"
    echo "================================"

    # Kiểm tra hosts
    if grep -q "^${HOST_IP}.*${HOSTNAME}.*${HOSTS_MARKER}" /etc/hosts 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Hosts entry: ${HOST_IP}  ${HOSTNAME}"
    elif grep -q "^#.*${HOST_IP}.*${HOSTNAME}.*${HOSTS_MARKER}" /etc/hosts 2>/dev/null; then
        echo -e "${YELLOW}⚠${NC} Hosts entry (commented): ${HOST_IP}  ${HOSTNAME}"
    else
        echo -e "${RED}✗${NC} No hosts entry"
    fi

    if grep -qE "^127\.[0-9.]+[[:space:]].*[[:space:]]${HOSTNAME}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
        echo -e "${YELLOW}⚠${NC} ${HOSTNAME} also exists on a 127.x.x.x hosts line"
    fi

    # Kiểm tra service
    if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Service: ${SERVICE_NAME} (running)"
        echo -e "${YELLOW}📝 Recent logs:${NC}"
        journalctl -u "${SERVICE_NAME}" --no-pager -n 10
    elif systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        echo -e "${YELLOW}⚠${NC} Service: ${SERVICE_NAME} (enabled but not running)"
    else
        echo -e "${RED}✗${NC} Service: ${SERVICE_NAME} (not installed)"
    fi
}

# Main
case "${1:-start}" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    status)
        do_status
        ;;
    logs)
        do_logs
        ;;
    restart)
        do_stop "no"
        do_start
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start dev server (systemd + hosts)"
        echo "  stop    - Stop dev server (cleanup)"
        echo "  status  - Check service status"
        echo "  logs    - Follow realtime logs"
        echo "  restart - Stop then start"
        exit 1
        ;;
esac

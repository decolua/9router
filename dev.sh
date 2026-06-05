#!/bin/bash

# Màu sắc cho output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cấu hình
HOST_IP="10.0.0.122"
HOSTNAME="9router.diepxuan.corp"
SERVICE_NAME="9router-dev"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Hàm kiểm tra quyền root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}❌ Cần quyền root. Chạy với sudo.${NC}"
        exit 1
    fi
}

# Hàm cập nhật /etc/hosts
update_hosts() {
    local action=$1  # "add" hoặc "remove"
    
    if [ "$action" = "add" ]; then
        if ! grep -q "${HOSTNAME}" /etc/hosts; then
            echo "${HOST_IP}  ${HOSTNAME}" >> /etc/hosts
            echo -e "${GREEN}✓ Added to /etc/hosts: ${HOST_IP}  ${HOSTNAME}${NC}"
        else
            # Uncomment nếu đã bị comment
            sed -i "s|^#.*${HOST_IP}.*${HOSTNAME}|${HOST_IP}  ${HOSTNAME}|" /etc/hosts
            echo -e "${GREEN}✓ Updated /etc/hosts: ${HOST_IP}  ${HOSTNAME}${NC}"
        fi
    else
        # Comment dòng hosts
        sed -i "s|^${HOST_IP}.*${HOSTNAME}|# ${HOST_IP}  ${HOSTNAME}|" /etc/hosts
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
    check_root
    
    echo -e "\n${YELLOW}🛑 Stopping 9Router development environment...${NC}"
    
    # Cập nhật hosts (comment)
    update_hosts "remove"
    
    # Quản lý systemd service
    manage_service "stop"
    
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
    if grep -q "^${HOST_IP}.*${HOSTNAME}" /etc/hosts 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Hosts entry: ${HOST_IP}  ${HOSTNAME}"
    elif grep -q "^#.*${HOST_IP}.*${HOSTNAME}" /etc/hosts 2>/dev/null; then
        echo -e "${YELLOW}⚠${NC} Hosts entry (commented): ${HOST_IP}  ${HOSTNAME}"
    else
        echo -e "${RED}✗${NC} No hosts entry"
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
        do_stop
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
#!/bin/bash

# Màu sắc cho output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Hàm dừng tất cả tiến trình
cleanup() {
    echo -e "\n${YELLOW}🛑 Stopping development environment...${NC}"
    
    # Dừng socat (port forwarding)
    if [ ! -z "$SOCAT_PID" ] && kill -0 $SOCAT_PID 2>/dev/null; then
        kill $SOCAT_PID 2>/dev/null
        echo -e "${GREEN}✓ Stopped socat port forwarding${NC}"
    fi
    
    # Dừng npm run dev
    if [ ! -z "$NPM_PID" ] && kill -0 $NPM_PID 2>/dev/null; then
        kill $NPM_PID 2>/dev/null
        echo -e "${GREEN}✓ Stopped npm dev server${NC}"
    fi
    
    echo -e "${GREEN}✅ Development environment stopped${NC}"
    exit 0
}

# Bắt tín hiệu Ctrl+C
trap cleanup SIGINT SIGTERM

# Kiểm tra socat đã được cài đặt chưa
if ! command -v socat &> /dev/null; then
    echo -e "${RED}❌ socat not found. Installing...${NC}"
    apt-get update && apt-get install -y socat
fi

echo -e "${GREEN}🚀 Starting development environment...${NC}"
echo -e "${YELLOW}📝 Traffic from 10.0.0.101:3000 will be forwarded to localhost:20128${NC}"
echo -e "${YELLOW}🔧 Press Ctrl+C to stop and revert to production${NC}"
echo ""

# Forward traffic từ 10.0.0.101:3000 đến localhost:20128 (port dev)
socat TCP-LISTEN:3000,bind=10.0.0.101,fork,reuseaddr TCP:localhost:20128 &
SOCAT_PID=$!

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Port forwarding active: 10.0.0.101:3000 → localhost:20128${NC}"
else
    echo -e "${RED}❌ Failed to start port forwarding${NC}"
    cleanup
    exit 1
fi

# Chạy npm run dev (development mode)
npm run dev &
NPM_PID=$!

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ npm dev server started on localhost:20128${NC}"
else
    echo -e "${RED}❌ Failed to start npm dev server${NC}"
    cleanup
    exit 1
fi

echo -e "${GREEN}✅ Development environment is ready!${NC}"
echo -e "${YELLOW}🌐 Access: http://10.0.0.101:3000 (redirected to local dev on port 20128)${NC}"
echo -e "${YELLOW}📝 Hot-reload enabled - changes will be reflected automatically${NC}"
echo ""

# Giữ script chạy và hiển thị log
wait $NPM_PID

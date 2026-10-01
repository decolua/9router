# 安装

9Router 的详细安装指南,附故障排除技巧。

---

## 要求

### 系统要求

- **Node.js**:版本 20.0.0 或更高
- **npm**:版本 10.0.0 或更高(随 Node.js 安装)
- **OS**:macOS、Linux、Windows(推荐 WSL)
- **磁盘空间**:安装约需 200MB

### 查看版本

```bash
node --version
# 应显示 v20.x.x 或更高

npm --version
# 应显示 10.x.x 或更高
```

**没有 Node.js?** 从 [nodejs.org](https://nodejs.org/) 安装

---

## 安装方式

### 方式 1:全局安装(推荐)

全局安装,任何位置都能使用:

```bash
npm install -g 9router
```

**启动 9Router:**

```bash
9router
```

**优势:**
- ✅ 任意目录均可运行
- ✅ 命令简单:`9router`
- ✅ 通过 `npm update -g 9router` 自动更新

### 方式 2:本地安装

在特定项目中安装:

```bash
mkdir my-9router
cd my-9router
npm install 9router
```

**启动 9Router:**

```bash
npx 9router
```

**优势:**
- ✅ 项目隔离
- ✅ 项目级版本控制
- ✅ 不污染全局命名空间

### 方式 3:源码安装(开发用)

从 GitHub 克隆并构建:

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install
npm run build
npm start
```

**优势:**
- ✅ 最新开发特性
- ✅ 可参与开发
- ✅ 可自定义修改

---

## 首次运行

### 启动服务器

```bash
9router
```

**发生了什么:**
1. 服务器启动在 `http://localhost:20128`
2. 仪表盘在浏览器中自动打开
3. 数据目录创建在 `~/.9router`
4. API key 自动生成

### 仪表盘登录

**默认凭据:**
- 密码:`123456`

**⚠️ 立即修改密码:**
1. 登录仪表盘
2. 设置 → 修改密码
3. 使用强密码

### 获取 API Key

```
仪表盘 → 设置 → API Keys
→ 复制你的 API key
→ 在 CLI 工具中使用
```

**API key 格式示例:**
```
9r_1234567890abcdef1234567890abcdef
```

---

## 验证安装

### 检查服务器状态

```bash
curl http://localhost:20128/health
```

**预期响应:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### 列出可用模型

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**预期响应:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### 测试 Chat Completion

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## 配置

### 环境变量

创建 `.env` 文件或设置环境变量:

```bash
# Security (REQUIRED in production)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# Storage
export DATA_DIR="~/.9router"

# Server
export PORT="20128"
export NODE_ENV="production"

# Logging
export ENABLE_REQUEST_LOGS="false"
```

### 数据目录

**默认位置:** `~/.9router`

**内容:**
```
~/.9router/
  ├── db.json           # 数据库(提供商、组合、使用)
  ├── api-keys.json     # API keys
  └── logs/             # 请求日志(若启用)
```

**修改位置:**

```bash
export DATA_DIR="/custom/path"
9router
```

### 端口配置

**默认端口:** `20128`

**修改端口:**

```bash
export PORT="3000"
9router
```

**或用命令行:**

```bash
9router --port 3000
```

---

## 故障排除

### 端口已被占用

**错误:**
```
Error: listen EADDRINUSE: address already in use :::20128
```

**方案 1:杀掉占用进程**

```bash
# 找到使用 20128 端口的进程
lsof -i :20128

# 杀掉进程
kill -9 <PID>
```

**方案 2:使用其他端口**

```bash
9router --port 3000
```

### 权限被拒绝

**错误:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/9router'
```

**方案:使用 sudo(不推荐)或修复 npm 权限**

```bash
# 修复 npm 权限(推荐)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# 然后重新安装
npm install -g 9router
```

### Node.js 版本过低

**错误:**
```
Error: The engine "node" is incompatible with this module
```

**方案:更新 Node.js**

```bash
# 使用 nvm(推荐)
nvm install 20
nvm use 20

# 或从 nodejs.org 下载
```

### 仪表盘无法打开

**问题:** 仪表盘没有自动打开

**方案 1:手动打开**

```
http://localhost:20128
```

**方案 2:检查防火墙**

```bash
# macOS: 在 System Preferences → Security 中允许 Node.js
# Linux: 检查 iptables
# Windows: 检查 Windows Firewall
```

### 无法连接提供商

**问题:** OAuth 登录失败或 API key 无效

**方案 1:检查网络连接**

```bash
ping google.com
```

**方案 2:检查提供商状态**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**方案 3:重新生成 API key**

```
仪表盘 → 提供商 → 断开 → 重新连接
```

### 内存占用过高

**问题:** 9Router 占用过多 RAM

**方案:重启服务器**

```bash
# 停止
pkill -f 9router

# 启动
9router
```

**或用 PM2 自动重启:**

```bash
npm install -g pm2
pm2 start 9router --name 9router
pm2 save
```

---

## 部署选项

### 本地开发

```bash
npm install -g 9router
9router
```

**适用场景:** 个人编码、测试

### VPS/云服务器

```bash
# 安装
npm install -g 9router

# 配置
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# 用 PM2 启动
npm install -g pm2
pm2 start 9router --name 9router
pm2 save
pm2 startup
```

**适用场景:** 团队访问、远程编码

### Docker

```bash
docker pull 9router/9router:latest

docker run -d \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v 9router-data:/root/.9router \
  --name 9router \
  9router/9router:latest
```

**适用场景:** 容器化部署、Kubernetes

### 反向代理(Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**适用场景:** HTTPS、自定义域名、负载均衡

---

## 卸载

### 移除全局安装

```bash
npm uninstall -g 9router
```

### 移除数据目录

```bash
rm -rf ~/.9router
```

### 移除配置

```bash
# 从 shell 配置中移除环境变量
nano ~/.bashrc  # 或 ~/.zshrc
# 删除 9router 相关的 export
```

---

## 下一步

- [入门指南](../getting-started.md) - 连接提供商并开始编码
- [功能特性](../features/) - 探索配额跟踪、组合、部署
- [故障排除](../troubleshooting.md) - 解决常见问题

---

## 需要帮助?

- **网站**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

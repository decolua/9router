# 🏠 本地部署

在本机运行 9Router,用于开发和个人使用。

---

## 📦 安装

通过 npm 全局安装 9Router:

```bash
npm install -g 9router
```

**要求:**
- Node.js 20 或更高
- npm 9 或更高

---

## 🚀 启动服务器

一条命令启动 9Router:

```bash
9router
```

仪表盘会自动在浏览器中打开,地址为 `http://localhost:3000`

**默认配置:**
- **仪表盘**: `http://localhost:3000`
- **API Endpoint**: `http://localhost:20128/v1`
- **数据目录**: `~/.9router`

---

## 🔧 配置

### 自定义数据目录

通过环境变量设置自定义数据目录:

```bash
DATA_DIR=/path/to/data 9router
```

### 自定义端口

API 端口(20128)和仪表盘端口(3000)在应用中配置。如需修改,你需要改源码或使用支持的环境变量(如果有)。

---

## 🛑 停止服务器

在运行 9Router 的终端中按 `Ctrl+C`。

```bash
# 在运行 9router 的终端中
^C  # 按 Ctrl+C
```

服务器会优雅关闭并保存所有数据。

---

## 🔄 重启服务器

再次运行启动命令即可:

```bash
9router
```

所有配置、API keys 和组合都保存在数据目录中。

---

## 📊 更新 9Router

更新到最新版本:

```bash
npm update -g 9router
```

查看当前版本:

```bash
npm list -g 9router
```

---

## 🔍 故障排除

### 端口已被占用

如果端口 20128 或 3000 已被占用:

```bash
# 找到使用该端口的进程(macOS/Linux)
lsof -i :20128
lsof -i :3000

# 杀掉进程
kill -9 <PID>
```

### 权限错误

安装过程中遇到权限错误:

```bash
# 使用 sudo(不推荐)
sudo npm install -g 9router

# 或修复 npm 权限(推荐)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### 数据目录问题

数据目录无法访问:

```bash
# 检查权限
ls -la ~/.9router

# 修复权限
chmod 755 ~/.9router
```

---

## 📁 数据目录结构

```
~/.9router/
├── db.json           # 主数据库(提供商、组合、设置)
├── logs/             # 应用日志
└── cache/            # 临时缓存文件
```

**备份数据:**

```bash
# 备份
cp -r ~/.9router ~/.9router.backup

# 恢复
cp -r ~/.9router.backup ~/.9router
```

---

## 🔗 下一步

- [连接提供商](/providers/subscription.md)
- [创建组合](/features/combos.md)
- [集成 CLI 工具](/integration/cursor.md)

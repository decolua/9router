#!/bin/bash
# File: update-9router.sh
# 9Router Update Script for AWS Ubuntu Server

echo "🔄 Starting 9router update to latest version..."

# 1. Backup database
echo "📦 Backing up database..."
cp -r ~/.9router/db ~/.9router/db.backup.$(date +%Y%m%d_%H%M%S)

# 2. Pull latest code
echo "⬇️ Pulling latest code..."
cd /path/to/9router
git fetch origin
git reset --hard origin/main

# 3. Install dependencies
echo "📥 Installing dependencies..."
bun install

# 4. Build
echo "🔨 Building application..."
npm run build:bun

# 5. Restart PM2
echo "🔄 Restarting PM2 process..."
pm2 restart 9router-custom

# 6. Show status
echo "✅ Update complete!"
pm2 list

echo ""
echo "🎉 9router updated successfully!"
echo "📊 Dashboard: http://$(curl -s ifconfig.me):20128"

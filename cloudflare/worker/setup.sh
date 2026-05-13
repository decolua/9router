#!/bin/bash
# 9Router Cloudflare Worker Setup Script
# Run this once to set up your Cloudflare Worker for tunnel registration

set -e

echo "🚀 Setting up 9Router Cloudflare Worker..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler is not installed"
    echo "   Install it with: npm install -g wrangler"
    exit 1
fi

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo "❌ Error: Not logged in to Cloudflare"
    echo "   Login with: wrangler login"
    exit 1
fi

echo "✅ wrangler is ready"

# Prompt for domain
read -p "Enter your domain (e.g., yourdomain.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Error: Domain is required"
    exit 1
fi

# Prompt for KV namespace name
read -p "Enter KV namespace name (default: TUNNEL_KV): " KV_NAME
KV_NAME=${KV_NAME:-TUNNEL_KV}

# Create KV namespace
echo "📦 Creating KV namespace..."
KV_OUTPUT=$(wrangler kv:namespace create "$KV_NAME" 2>&1)
KV_ID=$(echo "$KV_OUTPUT" | grep -oP '"id"\s*:\s*"\K[^"]+' || true)

if [ -z "$KV_ID" ]; then
    echo "❌ Error: Failed to create KV namespace"
    echo "   Output: $KV_OUTPUT"
    exit 1
fi

echo "✅ KV namespace created with ID: $KV_ID"

# Setup accent: .dev and production
echo "📝 Updating wrangler.toml..."
cat > wrangler.toml << EOF
name = "9router-tunnel-registration"
main = "tunnel-register.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# Public domain for tunnel URLs
[vars]
PUBLIC_DOMAIN = "$DOMAIN"

# KV namespace for storing tunnel mappings
[[kv_namespaces]]
binding = "$KV_NAME"
id = "$KV_ID"

# Route configuration (uncomment after creating DNS record)
# [routes]
# pattern = "r*.$DOMAIN/*"
# zone_name = "$DOMAIN"

# Production environment
[env.production]
name = "9router-tunnel-registration-production"
[env.production.vars]
PUBLIC_DOMAIN = "$DOMAIN"

# Staging environment (optional)
[env.staging]
name = "9router-tunnel-registration-staging"
[env.staging.vars]
PUBLIC_DOMAIN = "staging.$DOMAIN"
EOF

echo "✅ wrangler.toml created"

# Deploy worker
echo "🚀 Deploying to worker..."
wrangler deploy

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Add DNS record in your Cloudflare DNS:"
echo "      Type: A or CNAME"
echo "      Name: r.$DOMAIN (or r*.$DOMAIN for wildcard)"
echo "      Value: Your Worker URL or proxy to worker"
echo ""
echo "   2. OR use Workers Routes in Cloudflare Dashboard:"
echo "      Go to Workers → Your Worker → Triggers → Routes"
echo "      Add: r*.$DOMAIN/*"
echo ""
echo "   3. Set environment variables in 9Router Docker config:"
echo "      PUBLIC_DOMAIN=$DOMAIN"
echo "      TUNNEL_WORKER_URL=https://9router-tunnel-registration.$DOMAIN or worker URL"
echo ""
echo "   4. Test with:"
echo "      curl https://9router-tunnel-registration.your-subdomain.workers.dev/api/health"
echo ""
echo "📚 Documentation: See docs/CUSTOM_DOMAIN_TUNNEL.md for detailed instructions"
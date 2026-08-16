#!/bin/bash
# WagerPals Health Check Script
# Run this periodically to ensure the site is up

SITE_URL="https://www.wagerpals.io"
HEALTH_URL="https://www.wagerpals.io/api/health"

echo "🔍 Checking WagerPals health..."

# Check main site
HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$SITE_URL" 2>&1)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Main site: OK (HTTP $HTTP_CODE)"
else
    echo "❌ Main site: FAILED (HTTP $HTTP_CODE)"
fi

# Check health API
HEALTH_RESPONSE=$(curl -sL "$HEALTH_URL" 2>&1)
if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
    echo "✅ Health API: OK"
    echo "   Database: Connected"
else
    echo "❌ Health API: FAILED"
    echo "   Response: $HEALTH_RESPONSE"
fi

# Check static assets (to detect redirect loops)
STATIC_CODE=$(curl -sI "$SITE_URL/_next/static/chunks/webpack-ab364ee30b651afe.js" 2>&1 | head -1 | awk '{print $2}')
if [ "$STATIC_CODE" = "200" ]; then
    echo "✅ Static assets: OK"
else
    echo "⚠️  Static assets: HTTP $STATIC_CODE (may be cached or different file)"
fi

echo ""
echo "📊 Health check complete at $(date)"

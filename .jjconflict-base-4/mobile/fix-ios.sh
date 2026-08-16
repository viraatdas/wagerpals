#!/bin/bash

# Quick fix for iOS simulator connection issue

echo "🔧 WagerPals - iOS Simulator Fix"
echo "================================"
echo ""

# Get local IP
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
echo "✅ Your local IP: $LOCAL_IP"
echo ""

# Check if backend is running
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "✅ Backend is running on port 3000"
else
    echo "❌ Backend is NOT running"
    echo ""
    echo "Starting backend..."
    cd /Users/viraat/Documents/wagerpals-v2
    npm run dev &
    echo "⏳ Waiting for backend to start..."
    sleep 5
    echo "✅ Backend started"
fi

echo ""
echo "📱 Next steps:"
echo "1. Restart Expo (press 'r' in the terminal)"
echo "2. Try signing in again"
echo "3. Safari should now open: http://$LOCAL_IP:3000/auth/signin"
echo ""
echo "If you still have issues, make sure:"
echo "  - Backend is running: npm run dev"
echo "  - Your computer's firewall allows connections"
echo "  - You're on the same WiFi network"





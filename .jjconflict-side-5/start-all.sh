#!/bin/bash

echo "🚀 Starting WagerPals Backend and Mobile App"
echo "==========================================="
echo ""

# Kill any existing processes on port 3000
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "🔄 Stopping existing backend on port 3000..."
    kill -9 $(lsof -ti:3000) 2>/dev/null
    sleep 2
fi

# Start backend
echo "🔧 Starting backend server..."
cd /Users/viraat/Documents/wagerpals-v2
npm run dev > backend.log 2>&1 &
BACKEND_PID=$!

echo "⏳ Waiting for backend to start..."
sleep 5

# Check if backend is running
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "✅ Backend is running on port 3000"
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    echo "✅ Backend accessible at: http://$LOCAL_IP:3000"
    echo ""
    echo "📱 Now restart your Expo app:"
    echo "   1. Stop Expo (Ctrl+C)"
    echo "   2. Run: cd mobile && npm start"
    echo "   3. Press 'i' for iOS Simulator"
    echo ""
    echo "To view backend logs: tail -f backend.log"
else
    echo "❌ Backend failed to start. Check backend.log for errors"
    exit 1
fi

# Keep script running
wait $BACKEND_PID





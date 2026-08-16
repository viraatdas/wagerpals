#!/bin/bash

# WagerPals Mobile - Quick Test Script
# Run this to test the app end-to-end

set -e

echo "🚀 WagerPals Mobile - Quick Test"
echo "================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this from the project root directory"
    exit 1
fi

# Check if mobile directory exists
if [ ! -d "mobile" ]; then
    echo "❌ Error: mobile directory not found"
    exit 1
fi

echo "✅ Project structure looks good"
echo ""

# Check if backend is running
echo "📡 Checking if backend is running..."
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "⚠️  Backend not running. Start it with: npm run dev"
    echo ""
    read -p "Start backend now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Starting backend..."
        npm run dev &
        BACKEND_PID=$!
        echo "Waiting for backend to start..."
        sleep 5
    else
        echo "⚠️  Continuing without backend..."
    fi
fi
echo ""

# Check database migration
echo "🗄️  Checking database migration..."
read -p "Have you run 'npm run db:migrate-mobile'? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Running migration..."
    npm run db:migrate-mobile
fi
echo ""

# Install mobile dependencies
echo "📦 Installing mobile dependencies..."
cd mobile
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "✅ Dependencies already installed"
fi
echo ""

# Check .env file
echo "⚙️  Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "📝 Please edit mobile/.env with your configuration:"
    echo "   - EXPO_PUBLIC_API_URL=http://YOUR_IP:3000"
    echo "   - EXPO_PUBLIC_STACK_PROJECT_ID=..."
    echo "   - EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=..."
    echo ""
    read -p "Press Enter when ready..."
else
    echo "✅ .env file exists"
fi
echo ""

# Start Expo
echo "🎉 Everything is ready!"
echo ""
echo "Starting Expo development server..."
echo ""
echo "📱 To test on your device:"
echo "   1. Install Expo Go from App Store/Play Store"
echo "   2. Scan the QR code that appears"
echo ""
echo "💻 To test on simulator:"
echo "   - Press 'i' for iOS Simulator (Mac only)"
echo "   - Press 'a' for Android Emulator"
echo ""
echo "🧪 Test Checklist:"
echo "   ✓ Sign up with email/password"
echo "   ✓ Choose a username"
echo "   ✓ Create a group"
echo "   ✓ Share invite link"
echo "   ✓ Join from another device"
echo "   ✓ Approve member as admin"
echo "   ✓ Check push notifications"
echo ""

npm start

# Cleanup on exit
trap "kill $BACKEND_PID 2>/dev/null" EXIT





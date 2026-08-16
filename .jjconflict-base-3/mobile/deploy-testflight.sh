#!/bin/bash

# TestFlight Deployment Quick Start
# Run this script to deploy WagerPals to TestFlight

set -e  # Exit on error

echo "🚀 WagerPals TestFlight Deployment"
echo "===================================="
echo ""

# Check if we're in the mobile directory
if [ ! -f "app.json" ]; then
    echo "❌ Error: Must run from mobile directory"
    echo "Run: cd mobile && ./deploy-testflight.sh"
    exit 1
fi

# Check if EAS CLI is installed
if ! command -v eas &> /dev/null; then
    echo "❌ EAS CLI not found. Installing..."
    npm install -g eas-cli
fi

# Check if logged in to Expo
echo "📝 Checking Expo login..."
if ! eas whoami &> /dev/null; then
    echo "🔐 Please login to Expo:"
    eas login
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from example..."
    cp .env.example .env
    echo ""
    echo "📝 Please edit mobile/.env with your production values:"
    echo "   - EXPO_PUBLIC_API_URL"
    echo "   - EXPO_PUBLIC_STACK_PROJECT_ID"
    echo "   - EXPO_PUBLIC_STACK_PUBLISHABLE_KEY"
    echo ""
    read -p "Press enter when done editing .env..."
fi

# Check if project is initialized
echo "📦 Checking EAS project..."
if grep -q "your-eas-project-id" app.json; then
    echo "🆕 Initializing EAS project..."
    eas init
fi

# Ask user what they want to do
echo ""
echo "What would you like to do?"
echo "1) Build for TestFlight (Production)"
echo "2) Build for Internal Testing (Preview)"
echo "3) Submit existing build to TestFlight"
echo "4) Exit"
echo ""
read -p "Choose (1-4): " choice

case $choice in
    1)
        echo "🏗️  Building for TestFlight (Production)..."
        echo "This will take ~10-20 minutes..."
        eas build --platform ios --profile production
        echo ""
        echo "✅ Build complete!"
        echo ""
        read -p "Submit to TestFlight now? (y/n): " submit
        if [ "$submit" = "y" ]; then
            eas submit --platform ios --profile production
        fi
        ;;
    2)
        echo "🏗️  Building for Internal Testing (Preview)..."
        eas build --platform ios --profile preview
        ;;
    3)
        echo "📤 Submitting to TestFlight..."
        eas submit --platform ios --profile production
        ;;
    4)
        echo "👋 Exiting..."
        exit 0
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "✅ Done!"
echo ""
echo "Next steps:"
echo "1. Check App Store Connect: https://appstoreconnect.apple.com"
echo "2. Wait 5-10 minutes for processing"
echo "3. Add testers in TestFlight tab"
echo "4. Testers will receive email invites"
echo ""


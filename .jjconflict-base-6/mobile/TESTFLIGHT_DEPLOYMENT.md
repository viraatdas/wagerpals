# 🚀 TestFlight Deployment Guide for WagerPals iOS

## Prerequisites

Before you start, you need:
1. ✅ **Apple Developer Account** ($99/year) - https://developer.apple.com
2. ✅ **Expo Account** (free) - https://expo.dev
3. ✅ **Production API URL** - Your Vercel deployment URL
4. ✅ **Apple Team ID** - Found in Apple Developer portal

---

## Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

Verify installation:
```bash
eas --version
```

---

## Step 2: Login to Expo

```bash
eas login
```

If you don't have an account, create one at https://expo.dev

---

## Step 3: Configure Your Project

### A. Get your EAS Project ID

```bash
cd mobile
eas init
```

This will:
- Create a new project in your Expo account
- Update `app.json` with your project ID

### B. Update Environment Variables

1. Copy the example env file:
```bash
cp .env.example .env
```

2. Edit `.env` with your production values:
```bash
EXPO_PUBLIC_API_URL=https://your-domain.vercel.app
EXPO_PUBLIC_STACK_PROJECT_ID=your_stack_project_id
EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=your_stack_publishable_key
```

### C. Update `eas.json`

Replace these placeholders in `mobile/eas.json`:
- `your-apple-id@example.com` → Your Apple ID email
- `YOUR_APPLE_TEAM_ID` → Your Apple Team ID (10-character code)
- `your-app-store-connect-app-id` → Your App Store Connect App ID (will get this later)
- `https://your-domain.vercel.app` → Your production API URL

---

## Step 4: Set Up Apple App Store Connect

### A. Create App in App Store Connect

1. Go to https://appstoreconnect.apple.com
2. Click **"Apps"** → **"+"** → **"New App"**
3. Fill in:
   - **Platform**: iOS
   - **Name**: WagerPals
   - **Primary Language**: English
   - **Bundle ID**: `com.wagerpals.app` (must match app.json)
   - **SKU**: `wagerpals-app` (can be anything unique)
   - **User Access**: Full Access

4. **Important**: Copy the **App ID** (looks like `1234567890`)
   - Update this in `eas.json` under `submit.production.ios.ascAppId`

### B. Get Your Apple Team ID

1. Go to https://developer.apple.com/account
2. Click **"Membership"**
3. Copy your **Team ID** (10 characters, like `AB12CD34EF`)
4. Update in `eas.json` and root `.env.local` (APPLE_TEAM_ID)

---

## Step 5: Build for iOS

### Option A: Build for TestFlight (Production)

```bash
cd mobile
eas build --platform ios --profile production
```

This will:
- ✅ Build your app in the cloud
- ✅ Generate an IPA file
- ✅ Take ~10-20 minutes
- ✅ Automatically increment version numbers

### Option B: Build for Internal Testing (Preview)

```bash
eas build --platform ios --profile preview
```

---

## Step 6: Submit to TestFlight

After the build completes:

```bash
eas submit --platform ios --profile production
```

You'll be prompted to:
1. Select the build you just created
2. Enter your Apple ID credentials (if not saved)
3. Provide your Apple app-specific password (if using 2FA)

### Creating Apple App-Specific Password

1. Go to https://appleid.apple.com
2. Sign in with your Apple ID
3. Go to **"Security"** → **"App-Specific Passwords"**
4. Click **"Generate password"**
5. Name it "EAS Submit"
6. Copy the password and paste when prompted

---

## Step 7: TestFlight Access

After submission (takes ~5-10 minutes to process):

1. Go to https://appstoreconnect.apple.com
2. Click **"TestFlight"**
3. You'll see your build processing
4. Once ready, add testers:
   - Click **"Add Testers"**
   - Enter their email addresses
   - They'll receive an invite to download TestFlight

---

## Quick Commands Reference

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Initialize project (first time only)
cd mobile
eas init

# Build for iOS production
eas build --platform ios --profile production

# Build for iOS preview (internal testing)
eas build --platform ios --profile preview

# Submit to TestFlight
eas submit --platform ios --profile production

# Check build status
eas build:list

# View build logs
eas build:view

# Update credentials
eas credentials
```

---

## Troubleshooting

### Build Fails

**Problem**: "Missing credentials"
```bash
eas credentials
# Select iOS → Production → Add/Update credentials
```

**Problem**: "Invalid bundle identifier"
- Make sure `bundleIdentifier` in `app.json` matches Apple Developer portal
- Must be exactly: `com.wagerpals.app`

### Submit Fails

**Problem**: "Invalid App Store Connect credentials"
```bash
# Regenerate app-specific password
# Use new password when prompted
eas submit --platform ios
```

**Problem**: "ascAppId not found"
- Get App ID from App Store Connect
- Update `eas.json` with correct ID

### TestFlight Not Showing Build

- Wait 5-10 minutes after submission
- Check App Store Connect for processing status
- Refresh TestFlight tab

---

## Environment Variables Checklist

Make sure you have:

### Root `.env.local`
```bash
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
IOS_BUNDLE_IDENTIFIER=com.wagerpals.app
```

### Mobile `.env`
```bash
EXPO_PUBLIC_API_URL=https://your-domain.vercel.app
EXPO_PUBLIC_STACK_PROJECT_ID=your_stack_project_id
EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=your_stack_publishable_key
```

### Mobile `eas.json`
- Updated Apple ID email
- Updated Apple Team ID
- Updated App Store Connect App ID
- Updated production API URL

---

## Cost Breakdown

- **Apple Developer Account**: $99/year (required)
- **Expo Account**: Free (EAS Build has free tier)
- **EAS Build**: Free for first 30 builds/month, then varies
- **TestFlight**: Free (included with Apple Developer)

---

## Next Steps After TestFlight

Once your app is in TestFlight:

1. **Internal Testing** (0-100 people)
   - Share via email in App Store Connect
   - No Apple review needed
   - Can update instantly

2. **External Testing** (up to 10,000 people)
   - Requires Apple review (1-2 days)
   - Can share via public link
   - More like real App Store

3. **App Store Submission**
   - Submit for full App Store review
   - Fill out app details, screenshots, etc.
   - Usually takes 1-3 days for review

---

## Support

- **EAS Documentation**: https://docs.expo.dev/eas/
- **TestFlight Guide**: https://developer.apple.com/testflight/
- **Expo Discord**: https://chat.expo.dev

---

## Summary

To deploy to TestFlight, run these commands:

```bash
# 1. Install and login
npm install -g eas-cli
eas login

# 2. Configure project
cd mobile
eas init

# 3. Build
eas build --platform ios --profile production

# 4. Submit
eas submit --platform ios --profile production
```

**That's it!** Your app will be in TestFlight in ~20-30 minutes total. 🎉


# 🚀 TestFlight Deployment - Quick Summary

## ✅ What's Been Set Up

All the configuration is done! Here's what's ready:

- ✅ **EAS CLI** installed globally  
- ✅ **eas.json** configured with production/preview/development profiles
- ✅ **app.json** updated with environment variable support
- ✅ **.env.example** created with all needed variables
- ✅ **Deployment script** created for easy deployment
- ✅ **Full documentation** in `TESTFLIGHT_DEPLOYMENT.md`

---

## 📋 Before You Start - Prerequisites Checklist

You need these before deploying:

### 1. Apple Developer Account
- [ ] Paid Apple Developer account ($99/year)
- [ ] Sign up at: https://developer.apple.com

### 2. App Store Connect Setup  
- [ ] Create app in App Store Connect
- [ ] Get **App Store Connect App ID**
- [ ] Get **Apple Team ID** 

### 3. Expo Account
- [ ] Free Expo account at https://expo.dev
- [ ] Will login when running deployment

### 4. Production Environment
- [ ] Vercel deployment URL (your backend)
- [ ] Stack Auth credentials
- [ ] API accessible from internet

---

## 🚀 Quick Start (3 Commands)

Once you have the prerequisites above:

```bash
# 1. Go to mobile directory
cd mobile

# 2. Create .env with your production values
cp .env.example .env
# Edit .env with your values

# 3. Run deployment script
./deploy-testflight.sh
```

That's it! The script will:
- ✅ Check if you're logged in to Expo
- ✅ Initialize EAS project
- ✅ Build for iOS
- ✅ Submit to TestFlight

---

## 📝 Configuration You Need

### 1. Update `mobile/.env`

```bash
EXPO_PUBLIC_API_URL=https://your-domain.vercel.app
EXPO_PUBLIC_STACK_PROJECT_ID=your_stack_project_id
EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=your_stack_publishable_key
```

### 2. Update `mobile/eas.json`

Replace these placeholders:
- `your-apple-id@example.com` → Your Apple ID
- `YOUR_APPLE_TEAM_ID` → From Apple Developer portal  
- `your-app-store-connect-app-id` → From App Store Connect
- `https://your-domain.vercel.app` → Your production URL

### 3. Update Root `.env.local`

```bash
APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
IOS_BUNDLE_IDENTIFIER=com.wagerpals.app
```

---

## 🎯 Manual Deployment (Step by Step)

If you prefer manual control:

```bash
cd mobile

# 1. Login to Expo
eas login

# 2. Initialize project (first time only)
eas init

# 3. Build for iOS
eas build --platform ios --profile production

# 4. Submit to TestFlight  
eas submit --platform ios --profile production
```

---

## ⏱️ Timeline

- **First Time Setup**: 30 minutes
  - Apple Developer account setup
  - App Store Connect configuration
  - Environment variables

- **Build Time**: 10-20 minutes
  - Runs in Expo cloud
  - No local build needed

- **TestFlight Processing**: 5-10 minutes
  - Apple reviews binary
  - Makes available to testers

**Total**: ~45-60 minutes for first deployment

---

## 🔍 Checking Build Status

```bash
# View all builds
eas build:list

# View specific build
eas build:view

# Check submission status
eas submit:list
```

---

## 👥 Adding TestFlight Testers

After submission:

1. Go to https://appstoreconnect.apple.com
2. Click **TestFlight** tab
3. Click **Add Testers**
4. Enter email addresses
5. They'll receive TestFlight invite

**Internal Testing**: Up to 100 testers, no Apple review
**External Testing**: Up to 10,000 testers, requires Apple review

---

## 🐛 Common Issues

### "Must use physical device for Push Notifications"
- **Normal**: Push notifications don't work in simulators
- **Solution**: Test on real iPhone

### "No EAS project ID"
- **Problem**: Project not initialized
- **Solution**: Run `eas init` in mobile directory

### "Invalid credentials"
- **Problem**: Not logged in or wrong password
- **Solution**: Run `eas login` or regenerate app-specific password

### Build fails with "Missing bundle identifier"
- **Problem**: Bundle ID mismatch
- **Solution**: Ensure `com.wagerpals.app` in app.json matches Apple Developer portal

---

## 📚 Documentation

- **Full Guide**: `TESTFLIGHT_DEPLOYMENT.md`
- **EAS Docs**: https://docs.expo.dev/eas/
- **TestFlight**: https://developer.apple.com/testflight/

---

## 💰 Cost

- **Apple Developer**: $99/year (required)
- **Expo/EAS**: Free for first 30 builds/month
- **TestFlight**: Free (included with Apple Developer)

---

## ✅ Next Steps

1. **Get Apple Developer Account** if you don't have one
2. **Create app in App Store Connect**
3. **Copy `.env.example` to `.env`** and fill in values
4. **Update `eas.json`** with your Apple IDs
5. **Run `./deploy-testflight.sh`**

That's it! Your app will be in TestFlight in under an hour. 🎉

---

## 🆘 Need Help?

- **Expo Discord**: https://chat.expo.dev  
- **Apple Support**: https://developer.apple.com/support/
- **Full Guide**: Read `TESTFLIGHT_DEPLOYMENT.md` for detailed steps


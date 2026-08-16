# WagerPals Mobile App

React Native mobile application for WagerPals - place friendly bets with friends!

## Features

✅ **Authentication** - Sign in with email/password or Google  
✅ **Username Management** - Choose and edit your username  
✅ **Groups** - Create and join betting groups  
✅ **Pending Approval** - Clear indication when waiting for admin approval  
✅ **Push Notifications** - Get notified about bets, approvals, and promotions  
✅ **Deep Linking** - Share group invites via link  
✅ **Activity Feed** - See all recent activity  
✅ **Profile & Stats** - Track your betting performance  

## Prerequisites

- Node.js 18+ and npm
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (Mac) or Android Emulator
- EAS CLI for building (`npm install -g eas-cli`)

## Setup

### 1. Install Dependencies

```bash
cd mobile
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `EXPO_PUBLIC_API_URL` - Your backend API URL (e.g., http://localhost:3000 for development)
- `EXPO_PUBLIC_STACK_PROJECT_ID` - Stack Auth project ID (same as web)
- `EXPO_PUBLIC_STACK_PUBLISHABLE_KEY` - Stack Auth publishable key (same as web)

### 3. Update Backend Database Schema

Run this SQL on your database to add the new fields:

```sql
-- Add username_selected field
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_selected BOOLEAN DEFAULT FALSE;

-- Update push_subscriptions table to support Expo tokens
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS expo_token TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'web';
```

Or run the migration script from the root directory:

```bash
npm run db:migrate-mobile
```

### 4. Configure Deep Linking

Update `app.json` with your actual domain:

- Replace `wagerpals.app` with your production domain
- Update `bundleIdentifier` (iOS) and `package` (Android) with your app identifiers

## Development

### Run on iOS Simulator

```bash
npm run ios
```

### Run on Android Emulator

```bash
npm run android
```

### Run on Physical Device

```bash
npm start
```

Then scan the QR code with the Expo Go app on your device.

## Push Notifications

Push notifications work differently on mobile vs web:

- **Web**: Uses Web Push API with VAPID keys
- **Mobile**: Uses Expo Push Notification service

The backend automatically detects which type of token you're sending and handles it accordingly.

### Testing Push Notifications

1. Start the app on a physical device or simulator
2. Grant notification permissions when prompted
3. The app will automatically register for push notifications
4. Test by:
   - Joining a group and getting approved
   - Being promoted to admin
   - Someone placing a bet
   - Event being resolved

## Deep Linking

The app supports universal links and deep links:

- `wagerpals://` - Custom scheme
- `https://wagerpals.app/*` - Universal links (iOS)
- `https://*.wagerpals.app/*` - Universal links with subdomains

### Testing Deep Links

```bash
# iOS Simulator
xcrun simctl openurl booted "wagerpals://groups/join/ABC123"

# Android Emulator
adb shell am start -W -a android.intent.action.VIEW -d "wagerpals://groups/join/ABC123"
```

## Building for Production

### Configure EAS

First, log in to Expo:

```bash
eas login
```

Then configure your project:

```bash
eas build:configure
```

### Build for iOS

```bash
eas build --platform ios
```

For TestFlight, ensure:
- You have an Apple Developer account and App Store Connect app with bundle ID `com.wagerpals.app`.
- `EXPO_PUBLIC_EAS_PROJECT_ID` is set in `mobile/.env` (used for push token in dev).
- `extra.eas.projectId` in `app.json` is set to your real EAS project ID (optional for builds; required if you want consistency across tooling).
- In Vercel, set `APPLE_TEAM_ID` and `IOS_BUNDLE_IDENTIFIER` env vars so `/.well-known/apple-app-site-association` serves a valid file.

### Build for Android

```bash
eas build --platform android
```

### Submit to App Stores

```bash
# iOS App Store
eas submit --platform ios

# Google Play Store
eas submit --platform android
```

### TestFlight Checklist
- App opens deep links from `https://wagerpals.io/*` and `wagerpals://*`.
- Push notifications received on physical device after login.
- AASA file accessible at `https://wagerpals.io/.well-known/apple-app-site-association` (no redirect, content-type application/json).
- Backend `NEXT_PUBLIC_APP_URL` set to `https://wagerpals.io` in Vercel.

## Project Structure

```
mobile/
├── src/
│   ├── screens/          # All app screens
│   │   ├── AuthScreen.tsx
│   │   ├── UsernameSetupScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── ActivityScreen.tsx
│   │   ├── ExploreScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── GroupDetailScreen.tsx
│   │   ├── EventDetailScreen.tsx
│   │   ├── JoinGroupScreen.tsx
│   │   └── ...
│   ├── navigation/       # Navigation setup
│   │   ├── RootNavigator.tsx
│   │   └── MainTabNavigator.tsx
│   ├── services/         # API and services
│   │   ├── api.ts       # Backend API calls
│   │   ├── auth.ts      # Authentication
│   │   └── notifications.ts  # Push notifications
│   ├── components/       # Reusable components
│   ├── hooks/           # Custom React hooks
│   ├── types/           # TypeScript types
│   └── utils/           # Helper functions
├── assets/              # Images, icons, etc.
├── App.tsx             # Main app entry
├── app.json            # Expo configuration
└── eas.json            # EAS Build configuration
```

## Authentication Flow

1. User opens app
2. If not authenticated, show `AuthScreen`
3. User signs in with email/password or Google
4. If first time, show `UsernameSetupScreen`
5. User chooses username
6. Navigate to main app (`MainTabNavigator`)

## Group Membership Flow

1. User joins group (via code or invite link)
2. Join request is created with `status: 'pending'`
3. User sees "Pending Approval" message
4. Admin approves the request
5. User receives push notification
6. User can now access the group

## API Integration

All API calls go through `/api/*` routes on your backend:

- `POST /api/users` - Create/update user
- `GET /api/groups?userId=X` - Get user's groups
- `POST /api/groups` - Create group
- `POST /api/groups/join` - Join group
- `POST /api/groups/members` - Manage members (approve, promote, etc.)
- `GET /api/events?groupId=X` - Get events
- `POST /api/bets` - Place bet
- `POST /api/push/subscribe` - Register for push notifications

The mobile app uses the same backend as the web app.

## Troubleshooting

### Push Notifications Not Working

- Make sure you're testing on a physical device (push doesn't work on iOS simulator)
- Check that notification permissions are granted
- Verify the Expo push token is being saved to database
- Check backend logs for push notification errors

### Deep Links Not Working

- Make sure your domain is configured in `app.json`
- For iOS, universal links require AASA file on your domain
- For Android, make sure intent filters are configured
- Test with the command line tools first before testing in app

### Authentication Issues

- Verify Stack Auth credentials in `.env`
- Make sure backend API URL is correct
- Check that CORS is enabled on backend for mobile requests
- Verify OAuth redirect URLs are configured in Stack Auth dashboard

## Next Steps

- Implement remaining screens (GroupDetail, EventDetail, etc.)
- Add group admin management interface
- Create reusable components (EventCard, BetForm, etc.)
- Add offline support with local caching
- Implement pull-to-refresh on all lists
- Add animations and transitions
- Optimize performance
- Add error tracking (Sentry)
- Add analytics (Mixpanel, Amplitude, etc.)

## Support

For issues or questions, please open an issue on GitHub or contact the development team.





# WagerPals v2

[![Uptime Status](https://img.shields.io/badge/status-live-brightgreen)](https://stats.uptimerobot.com/DLPMolyHJj)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fwww.wagerpals.io)](https://www.wagerpals.io)

**[📊 View Status Page](https://stats.uptimerobot.com/DLPMolyHJj)** | **[🌐 Visit WagerPals](https://www.wagerpals.io)**

Comprehensive guide for the full WagerPals project, including both web and mobile applications.

## Project Structure

```
wagerpals-v2/
├── app/              # Next.js web application
├── components/       # Shared web components
├── lib/             # Shared backend logic, database, and types
├── mobile/          # React Native mobile app (NEW!)
├── public/          # Static assets for web
└── scripts/         # Database scripts and utilities
```

## Quick Start

### Web Application

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your values

# Initialize database
npm run db:init

# Start development server
npm run dev
```

Visit http://localhost:3000

### Mobile Application

```bash
# Navigate to mobile directory
cd mobile

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Run the migration for mobile support
cd ..
npm run db:migrate-mobile

# Start Expo
cd mobile
npm start
```

## Migration Guide (Existing Users)

If you already have the web app running, follow these steps to add mobile support:

### 1. Update Database Schema

```bash
npm run db:migrate-mobile
```

This adds:
- `username_selected` column to `users` table
- Mobile push notification support to `push_subscriptions` table

### 2. Deploy Backend Changes

The backend API changes are backward-compatible and will work for both web and mobile:

- Updated `/api/push/subscribe` to accept Expo push tokens
- Updated `/api/groups/members` to send push notifications for approvals/promotions
- Updated `lib/push.ts` to support both web push and Expo push

Simply deploy your Next.js app as usual:

```bash
npm run build
# Deploy to Vercel or your hosting provider
```

### 3. Configure Mobile Deep Linking

Update `mobile/app.json` with your production domain:

```json
{
  "expo": {
    "scheme": "wagerpals",
    "ios": {
      "bundleIdentifier": "com.yourcompany.wagerpals",
      "associatedDomains": [
        "applinks:your-domain.com"
      ]
    },
    "android": {
      "package": "com.yourcompany.wagerpals",
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [
            {
              "scheme": "https",
              "host": "your-domain.com"
            }
          ]
        }
      ]
    }
  }
}
```

### 4. Build and Deploy Mobile App

See `mobile/README.md` for detailed instructions on:
- Building with EAS
- Submitting to App Store and Google Play
- Testing push notifications
- Configuring deep links

## Features

### Web App
- ✅ PWA with offline support
- ✅ Web push notifications
- ✅ Responsive design
- ✅ Group management
- ✅ Event creation and resolution
- ✅ Real-time activity feed

### Mobile App (NEW!)
- ✅ Native iOS and Android apps
- ✅ Expo push notifications
- ✅ Deep linking for group invites
- ✅ Username selection flow
- ✅ Pending approval indication
- ✅ Profile and stats
- ✅ All core web features

## Database Schema

See `lib/schema.sql` for the complete schema.

Key tables:
- `users` - User accounts and stats
- `groups` - Betting groups
- `group_members` - Group membership and roles
- `events` - Betting events
- `bets` - Individual bets
- `comments` - Event comments
- `activities` - Activity feed
- `push_subscriptions` - Push notification tokens (web & mobile)

## API Routes

All API routes are in `app/api/`:

### Users
- `GET /api/users?id=X` - Get user by ID
- `GET /api/users?username=X` - Get user by username
- `POST /api/users` - Create/update user

### Groups
- `GET /api/groups?userId=X` - Get user's groups
- `POST /api/groups` - Create group
- `POST /api/groups/join` - Join group
- `POST /api/groups/members` - Manage members

### Events
- `GET /api/events?groupId=X` - Get events
- `GET /api/events?id=X` - Get event details
- `POST /api/events` - Create event
- `POST /api/events/resolve` - Resolve event
- `POST /api/events/delete` - Delete event

### Bets & Comments
- `POST /api/bets` - Place bet
- `GET /api/comments?eventId=X` - Get comments
- `POST /api/comments` - Add comment

### Push Notifications
- `POST /api/push/subscribe` - Register for push (web or mobile)
- `DELETE /api/push/subscribe` - Unsubscribe

## Environment Variables

### Backend (.env.local)
```env
# Database
POSTGRES_URL=...
POSTGRES_PRISMA_URL=...
# ... other Postgres vars

# Stack Auth
NEXT_PUBLIC_STACK_PROJECT_ID=...
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=...
STACK_SECRET_SERVER_KEY=...

# App URL
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Web Push (for web app)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
```

### Mobile (mobile/.env)
```env
# API URL
EXPO_PUBLIC_API_URL=https://your-domain.com

# Stack Auth (same as web)
EXPO_PUBLIC_STACK_PROJECT_ID=...
EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=...
```

## Deployment

### Web App
Deploy to Vercel (recommended):
```bash
vercel --prod
```

Or any Next.js-compatible hosting.

### Mobile App
Build and submit with EAS:
```bash
cd mobile
eas build --platform all
eas submit --platform all
```

## Development Workflow

1. **Backend/API Changes**: Make changes in `app/api/` or `lib/`
2. **Web Changes**: Edit `app/`, `components/`, or styles
3. **Mobile Changes**: Edit `mobile/src/`
4. **Database Changes**: Update `lib/schema.sql` and create migration script
5. **Testing**: Test on both web and mobile before deploying

## Push Notifications

The system supports two types of push notifications:

### Web Push (PWA)
- Uses Web Push API with VAPID keys
- Requires service worker
- Works on Chrome, Firefox, Edge, Safari

### Expo Push (Mobile)
- Uses Expo's push notification service
- Works on iOS and Android
- No configuration needed for development

### Backend Implementation
The backend automatically detects the platform and sends the appropriate notification type:

```typescript
// Web push subscription
{ endpoint: "...", keys: { p256dh: "...", auth: "..." } }

// Expo push subscription
{ token: "ExponentPushToken[...]", userId: "..." }
```

Both are stored in the `push_subscriptions` table with a `platform` field.

## Troubleshooting

### Database Issues
```bash
# Reset database (CAUTION: Deletes all data)
npm run db:clean
npm run db:init

# Or just add new tables/columns
npm run db:migrate-mobile
```

### Push Notification Issues
- Check backend logs for detailed error messages
- Verify VAPID keys are set (web)
- Ensure Expo push token is valid (mobile)
- Test with `/api/push/test` endpoint

### Mobile Build Issues
- Clear Expo cache: `expo start -c`
- Reinstall dependencies: `cd mobile && rm -rf node_modules && npm install`
- Check EAS build logs for errors

## Next Steps

- [ ] Implement remaining mobile screens (GroupDetail, EventDetail)
- [ ] Add group admin interface on mobile
- [ ] Implement Hard Mode (real money wagering)
- [ ] Add in-app messaging
- [ ] Implement social features (friend system)
- [ ] Add achievement system
- [ ] Implement analytics
- [ ] Add error tracking (Sentry)

## License

Private - All Rights Reserved

## Support

For questions or issues, contact the development team.

# 🔐 Stack Auth Setup for Mobile App

## 📋 Quick Answer

**Add these redirect URIs in your Stack Auth dashboard:**

### For Development (Expo Go)
```
exp://localhost:19000/--/oauth/callback
```

### For Production (Standalone App)
```
wagerpals://oauth/callback
```

---

## 🛠️ Complete Setup Instructions

### 1. Configure Stack Auth Dashboard

Go to https://app.stack-auth.com and configure your project:

#### **OAuth Settings**

Navigate to: **Settings → OAuth → Redirect URIs**

Add these redirect URIs:

```
# Development (Expo Go)
exp://localhost:19000/--/oauth/callback

# Production (Standalone App)  
wagerpals://oauth/callback

# Web (already configured)
http://localhost:3000/handler/oauth/callback
https://your-domain.vercel.app/handler/oauth/callback
```

---

### 2. Environment Variables

Make sure you have these in your root `.env.local`:

```env
NEXT_PUBLIC_STACK_PROJECT_ID=your_stack_project_id
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=your_stack_publishable_key
STACK_SECRET_SERVER_KEY=your_stack_secret_key
```

And in `mobile/.env`:

```env
EXPO_PUBLIC_STACK_PROJECT_ID=your_stack_project_id
EXPO_PUBLIC_STACK_PUBLISHABLE_KEY=your_stack_publishable_key
```

---

### 3. Test OAuth Flow

#### Start Backend
```bash
npm run dev
```

#### Start Mobile App
```bash
cd mobile
npm start
# Press 'a' for Android or 'i' for iOS
```

#### Test Sign In
1. Open the app
2. Tap "Continue with Google"
3. Browser should open for Google sign in
4. After signing in, you'll be redirected back to the app
5. App should show username selection screen

---

## 🔍 How It Works

### OAuth Flow Diagram

```
Mobile App → Opens Browser → Stack Auth → Google Sign In
     ↑                                            ↓
     └──────── Redirects with code ←─────────────┘
                    ↓
          Backend (/api/auth/mobile-callback)
                    ↓
          Exchange code for user tokens
                    ↓
          Return user data to mobile app
                    ↓
          Store in secure storage
```

### URL Structure

**Authorization URL:**
```
https://api.stack-auth.com/api/v1/auth/oauth/authorize
  ?client_id=YOUR_PROJECT_ID
  &redirect_uri=exp://localhost:19000/--/oauth/callback
  &response_type=code
  &provider=google
```

**Redirect URI (Development):**
```
exp://localhost:19000/--/oauth/callback?code=AUTHORIZATION_CODE
```

**Redirect URI (Production):**
```
wagerpals://oauth/callback?code=AUTHORIZATION_CODE
```

---

## 🐛 Troubleshooting

### Problem: "Redirect URI mismatch"

**Solution:** Make sure the redirect URI in Stack Auth dashboard **exactly matches** the one used in the app:
- Development: `exp://localhost:19000/--/oauth/callback`
- Production: `wagerpals://oauth/callback`

### Problem: "Browser doesn't redirect back to app"

**Solution:** 
1. Make sure you have the correct scheme in `app.json`:
   ```json
   {
     "expo": {
       "scheme": "wagerpals"
     }
   }
   ```
2. Restart Expo server after changing `app.json`

### Problem: "User info not returned"

**Solution:** Check backend logs at `/api/auth/mobile-callback` for errors. The endpoint should successfully exchange the auth code for tokens.

---

## 📱 Alternative: Email/Password Auth

If you don't want to set up OAuth right now, you can use email/password authentication which works immediately without additional configuration:

```typescript
// In the app, just use:
await authService.signInWithEmail(email, password);
```

This will work as soon as you have Stack Auth configured with email/password enabled in your dashboard.

---

## ✅ Testing Checklist

- [ ] Added redirect URIs to Stack Auth dashboard
- [ ] Environment variables configured
- [ ] Backend is running (`npm run dev`)
- [ ] Mobile app is running (`npm start`)
- [ ] Can tap "Continue with Google"
- [ ] Browser opens with Google sign in
- [ ] After signing in, redirects back to app
- [ ] App shows username selection screen
- [ ] Username is saved and remembered

---

## 📚 Additional Resources

- **Stack Auth Docs**: https://docs.stack-auth.com
- **Stack Auth Dashboard**: https://app.stack-auth.com
- **Expo Auth Session**: https://docs.expo.dev/versions/latest/sdk/auth-session/
- **Expo Deep Linking**: https://docs.expo.dev/guides/deep-linking/

---

## 💡 Quick Start Without OAuth

If you want to test the app immediately without setting up OAuth:

1. **Use Email/Password Sign In** (works immediately)
2. **Or skip auth temporarily** by commenting out the auth check in screens

Once you're ready to add OAuth, just follow this guide!





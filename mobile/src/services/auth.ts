// Authentication service. Email/magic-link goes through the web app's Stack
// Auth-backed endpoints; Google uses the NATIVE iOS Google Sign-In SDK (the
// system account picker) and exchanges the resulting Google ID token for a
// Stack session at /api/auth/google-native. No in-app browser is involved.
import {
  GoogleSignin,
  isSuccessResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { AuthUser } from '../types';
import {
  setSharedItem,
  getSharedItem,
  publishSharedIdentity,
  clearSharedSession,
  migrateLegacySecureStore,
} from './shared-session';

// @ts-ignore
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__
  ? 'http://localhost:3000'
  : 'https://www.wagerpals.io');

// The existing Web OAuth client id (Google Cloud console → Credentials). This
// is a public identifier, not a secret. Passing it as webClientId is what
// makes the native SDK return an `idToken` we can verify server-side, and it
// is also one of the audiences /api/auth/google-native accepts.
const GOOGLE_WEB_CLIENT_ID =
  // @ts-ignore
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  '1084366774946-9t37qi8aaj3v3k69fnkggf7qq2egl0m3.apps.googleusercontent.com';

// The iOS OAuth client id. It does NOT exist yet — the owner is creating it in
// the Google Cloud console (iOS client, bundle id com.wagerpals.app). It MUST
// be set (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in mobile/.env, and mirrored into
// EAS build env) BEFORE building, and its reversed form must be the iOS URL
// scheme injected by app.config.js. Without it, native Google sign-in cannot
// start.
const GOOGLE_IOS_CLIENT_ID =
  // @ts-ignore
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    offlineAccess: false,
  });
  googleConfigured = true;
}

class AuthService {
  private currentUser: AuthUser | null = null;
  private listeners: ((user: AuthUser | null) => void)[] = [];

  async init() {
    try {
      // Must run before any read below: this app used to store the session
      // under SecureStore's default (unshared) keychain location. If we read
      // the new shared location first, an already-signed-in user whose
      // session hasn't been migrated yet would look signed out.
      await migrateLegacySecureStore();

      const storedUser = await getSharedItem('user');
      const storedToken = await getSharedItem('accessToken');

      if (storedUser && storedToken) {
        this.currentUser = JSON.parse(storedUser);
        this.notifyListeners();
        // Refresh last_seen_at and any newly-linked auth method for a returning user.
        // Not awaited — must not block session restore.
        this.syncUser().catch((error) => {
          console.warn('Failed to sync user on init:', error);
        });
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
    }
  }

  // Pure identity sync — ensures the backend row exists and is up to date
  // (verified email, display name, avatar, auth methods, last_seen_at).
  // Never renames the user. Failure is non-fatal; callers should not block on it.
  async syncUser(): Promise<void> {
    try {
      const { default: apiService } = await import('./api');
      const syncedUser = await apiService.syncUser();

      // Publish the shared session for the iMessage extension here, right
      // after a successful sync — this is the only point where we have the
      // real WagerPals username (backend `/api/users` response), as opposed
      // to the email local-part used as a placeholder displayName during
      // sign-in. Both signInWithCode/signInWithGoogle (which await this
      // method) and init() (session restore) funnel through here.
      if (this.currentUser && syncedUser?.username) {
        await publishSharedIdentity({
          id: syncedUser.id || this.currentUser.id,
          username: syncedUser.username,
          displayName: this.currentUser.displayName ?? null,
        });
      }
    } catch (error) {
      console.warn('User sync failed:', error);
    }
  }

  async sendMagicLink(email: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mobile-magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send verification code');
    }
  }

  async signInWithCode(email: string, code: string): Promise<AuthUser> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mobile-verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Invalid verification code');
    }

    const data = await response.json();

    if (data.access_token) {
      await setSharedItem('accessToken', data.access_token);
    }
    if (data.refresh_token) {
      await setSharedItem('refreshToken', data.refresh_token);
    }

    const user: AuthUser = {
      id: data.user_id || data.id || '',
      email: data.email || email,
      displayName: data.display_name || email.split('@')[0],
      primaryEmail: data.email || email,
    };

    await this.setUser(user);
    await this.syncUser();
    return user;
  }

  async signInWithGoogle(): Promise<AuthUser> {
    try {
      ensureGoogleConfigured();

      // No-op on iOS (Play Services is Android-only) but harmless, and keeps
      // the call site correct if Android is ever enabled.
      await GoogleSignin.hasPlayServices();

      // Native system account picker. Returns { type: 'success', data } or
      // { type: 'cancelled' } — it does not throw on a plain cancel.
      const response = await GoogleSignin.signIn();

      if (!isSuccessResponse(response)) {
        throw new Error('Authentication cancelled');
      }

      const idToken = response.data.idToken;
      if (!idToken) {
        throw new Error('Google did not return an identity token. Please try again.');
      }

      // Exchange the verified-by-us-on-the-server Google ID token for a Stack
      // session.
      const res = await fetch(`${API_BASE_URL}/api/auth/google-native`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not sign you in with Google. Please try again.');
      }

      const data = await res.json();

      if (data.access_token) {
        await setSharedItem('accessToken', data.access_token);
      }
      if (data.refresh_token) {
        await setSharedItem('refreshToken', data.refresh_token);
      }

      const user: AuthUser = {
        id: data.user_id || data.id || '',
        email: data.email || '',
        displayName: data.display_name || data.email?.split('@')[0] || 'User',
        primaryEmail: data.email || '',
      };

      await this.setUser(user);
      await this.syncUser();
      return user;
    } catch (error: any) {
      // A user backing out of the native sheet is not an error worth
      // surfacing. The SDK signals cancel either as a typed response (handled
      // above) or, for some operations, as an error code.
      if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Authentication cancelled');
      }
      if (error?.message === 'Authentication cancelled') {
        throw error;
      }

      console.error('Google sign in error:', error);
      throw error;
    }
  }

  async signInWithApple(): Promise<AuthUser> {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      // Native Sign in with Apple sheet. Requesting FULL_NAME + EMAIL — Apple
      // only returns these on the user's FIRST authorization for this app;
      // every later sign-in returns just the identity token. We capture them
      // here and forward them so the backend can seed a display name and, if
      // the token ever omits the email, use it as a lookup hint.
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (error: any) {
      // Backing out of the native sheet is not an error worth surfacing —
      // mirror the Google path and throw the same cancel sentinel.
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('Authentication cancelled');
      }
      console.error('Apple sign in error:', error);
      throw error;
    }

    const identityToken = credential.identityToken;
    if (!identityToken) {
      throw new Error('Apple did not return an identity token. Please try again.');
    }

    // fullName is Apple's structured name; it is null on non-first sign-ins.
    const fullName = credential.fullName
      ? {
          givenName: credential.fullName.givenName ?? undefined,
          familyName: credential.fullName.familyName ?? undefined,
        }
      : undefined;

    // Exchange the verified-by-us-on-the-server Apple identity token for a
    // Stack session.
    const res = await fetch(`${API_BASE_URL}/api/auth/apple-native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityToken,
        fullName,
        email: credential.email ?? undefined,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not sign you in with Apple. Please try again.');
    }

    const data = await res.json();

    if (data.access_token) {
      await setSharedItem('accessToken', data.access_token);
    }
    if (data.refresh_token) {
      await setSharedItem('refreshToken', data.refresh_token);
    }

    const user: AuthUser = {
      id: data.user_id || data.id || '',
      email: data.email || '',
      displayName: data.display_name || data.email?.split('@')[0] || 'User',
      primaryEmail: data.email || '',
    };

    await this.setUser(user);
    await this.syncUser();
    return user;
  }

  async signOut() {
    try {
      await this.clearStorage();
      this.currentUser = null;
      this.notifyListeners();
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  private async clearStorage() {
    // Wipes accessToken/refreshToken/user AND the `sharedSession` key, so the
    // iMessage extension loses access the moment the user signs out of the
    // main app.
    await clearSharedSession();
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  async getAccessToken(): Promise<string | null> {
    try {
      return await getSharedItem('accessToken');
    } catch {
      return null;
    }
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void) {
    this.listeners.push(callback);
    callback(this.currentUser);

    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private async setUser(user: AuthUser) {
    this.currentUser = user;
    await setSharedItem('user', JSON.stringify(user));
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentUser));
  }
}

export default new AuthService();

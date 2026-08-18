// Authentication service using Stack Auth via web-based OAuth
import * as WebBrowser from 'expo-web-browser';
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
      const callbackUrl = 'wagerpals://oauth-callback';
      const oauthUrl = `${API_BASE_URL}/api/auth/mobile-oauth?provider=google&callback_url=${encodeURIComponent(callbackUrl)}`;

      // Open the OAuth URL in an in-app browser
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, callbackUrl);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        throw new Error('Authentication cancelled');
      }

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const params = url.searchParams;

        const error = params.get('error');
        if (error) {
          throw new Error(error);
        }

        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const userId = params.get('user_id');
        const email = params.get('email');
        const displayName = params.get('display_name');

        if (!accessToken) {
          throw new Error('No access token received');
        }

        await setSharedItem('accessToken', accessToken);
        if (refreshToken) {
          await setSharedItem('refreshToken', refreshToken);
        }

        const user: AuthUser = {
          id: userId || '',
          email: email || '',
          displayName: displayName || email?.split('@')[0] || 'User',
          primaryEmail: email || '',
        };

        await this.setUser(user);
        await this.syncUser();
        return user;
      }

      throw new Error('Authentication failed');
    } catch (error: any) {
      console.error('Google sign in error:', error);

      if (error.message?.includes('cancelled') || error.message?.includes('canceled')) {
        throw new Error('Authentication cancelled');
      }

      throw error;
    }
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

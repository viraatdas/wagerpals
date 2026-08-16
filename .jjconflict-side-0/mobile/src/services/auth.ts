// Authentication service using Stack Auth via web-based OAuth
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AuthUser } from '../types';

// @ts-ignore
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__
  ? 'http://localhost:3000'
  : 'https://wagerpals.io');

class AuthService {
  private currentUser: AuthUser | null = null;
  private listeners: ((user: AuthUser | null) => void)[] = [];

  async init() {
    try {
      const storedUser = await SecureStore.getItemAsync('user');
      const storedToken = await SecureStore.getItemAsync('accessToken');

      if (storedUser && storedToken) {
        this.currentUser = JSON.parse(storedUser);
        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
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
      await SecureStore.setItemAsync('accessToken', data.access_token);
    }
    if (data.refresh_token) {
      await SecureStore.setItemAsync('refreshToken', data.refresh_token);
    }

    const user: AuthUser = {
      id: data.user_id || data.id || '',
      email: data.email || email,
      displayName: data.display_name || email.split('@')[0],
      primaryEmail: data.email || email,
    };

    await this.setUser(user);
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

        await SecureStore.setItemAsync('accessToken', accessToken);
        if (refreshToken) {
          await SecureStore.setItemAsync('refreshToken', refreshToken);
        }

        const user: AuthUser = {
          id: userId || '',
          email: email || '',
          displayName: displayName || email?.split('@')[0] || 'User',
          primaryEmail: email || '',
        };

        await this.setUser(user);
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
    await SecureStore.deleteItemAsync('user');
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  async getAccessToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync('accessToken');
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
    await SecureStore.setItemAsync('user', JSON.stringify(user));
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentUser));
  }
}

export default new AuthService();

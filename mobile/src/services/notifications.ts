// Push notification service using Expo Notifications
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform, AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { EventSubscription, PermissionStatus } from 'expo-modules-core';
import apiService from './api';

// Untrusted payload coming straight from a push message; only these fields
// are ever read, and only after being narrowed at runtime.
export type NotificationPayloadData = {
  url?: string;
  eventId?: string;
  tag?: string;
};

export type NavigationTarget = { screen: string; params: Record<string, unknown> };
export type NavigationHandler = (target: NavigationTarget) => void;

// Paths the RootNavigator's `linking` config already understands. Anything
// derived from `data.url` must match this whitelist before we ever open it -
// the payload is attacker-controlled, so we never forward it verbatim.
const KNOWN_PATH_PREFIXES = ['events/', 'groups/'];
const KNOWN_PATHS = ['activity', 'explore'];

function isNotificationPayloadData(value: unknown): value is NotificationPayloadData {
  return typeof value === 'object' && value !== null;
}

function resolveDeepLinkPath(raw: unknown): string | null {
  if (!isNotificationPayloadData(raw)) return null;

  if (typeof raw.eventId === 'string' && raw.eventId.length > 0) {
    return `events/${encodeURIComponent(raw.eventId)}`;
  }

  if (typeof raw.url === 'string' && raw.url.length > 0) {
    const path = raw.url.replace(/^\/+/, '');
    if (KNOWN_PATHS.includes(path) || KNOWN_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
      return path;
    }
  }

  return null;
}

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // iOS specific fields (SDK 54+)
    shouldShowBanner: true,
    shouldShowList: true,
    // Cross-platform
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationService {
  private expoPushToken: string | null = null;
  private permissionStatus: PermissionStatus | null = null;
  private lastRegistered: { token: string; userId: string } | null = null;
  private navigationHandler: NavigationHandler | null = null;

  private notificationListener: EventSubscription | null = null;
  private responseListener: EventSubscription | null = null;
  private pushTokenListener: EventSubscription | null = null;
  private appStateListener: NativeEventSubscription | null = null;

  private listenersReady = false;
  private initPromise: Promise<string | null> | null = null;
  private lastHandledResponseId: string | null = null;

  async init(userId?: string): Promise<string | null> {
    // Guard against overlapping calls (e.g. RootNavigator re-running its
    // effect while a previous init is still in flight) so we never fire two
    // concurrent subscribe requests for the same user.
    if (this.initPromise) {
      await this.initPromise;
    }

    this.initPromise = this.doInit(userId);
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(userId?: string): Promise<string | null> {
    try {
      await this.ensurePermissionsAndListeners();

      // Always attempt to get a token - if a previous attempt failed (or
      // returned null on a simulator) we retry every time init is called,
      // rather than giving up forever like the old "initialized" flag did.
      const token = await this.getExpoPushToken();

      if (token && userId) {
        await this.registerIfChanged(token, userId);
      }

      await this.routeInitialNotificationResponse();

      return token;
    } catch (error) {
      console.error('[notifications] init failed:', error);
      return null;
    }
  }

  private async ensurePermissionsAndListeners(): Promise<void> {
    try {
      await this.requestPermissions();
    } catch (error) {
      console.error('[notifications] permission request failed:', error);
    }

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch (error) {
        console.warn('[notifications] failed to set Android notification channel:', error);
      }
    }

    if (!this.listenersReady) {
      this.setupListeners();
      this.listenersReady = true;
    }
  }

  private async requestPermissions(): Promise<PermissionStatus | null> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      finalStatus = status;
    }

    this.permissionStatus = finalStatus;
    if (finalStatus !== 'granted') {
      console.warn('[notifications] permission not granted, status:', finalStatus);
    }
    return finalStatus;
  }

  getPermissionStatus(): PermissionStatus | null {
    return this.permissionStatus;
  }

  async getExpoPushToken(): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn('[notifications] running on a simulator/emulator, skipping push token fetch');
      return null;
    }

    try {
      // Prefer env, then app config (works in Expo Go and dev builds)
      const projectId =
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
        (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
        (Constants as any)?.easConfig?.projectId;
      const token = projectId
        ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
        : (await Notifications.getExpoPushTokenAsync()).data;
      this.expoPushToken = token;
      return token;
    } catch (error) {
      console.error('[notifications] error getting push token:', error);
      return null;
    }
  }

  private setupListeners(): void {
    // Handle notifications received while app is in foreground
    this.notificationListener = Notifications.addNotificationReceivedListener(async () => {
      try {
        const current = await Notifications.getBadgeCountAsync();
        await Notifications.setBadgeCountAsync(current + 1);
      } catch (error) {
        console.warn('[notifications] failed to bump badge count:', error);
      }
    });

    // Handle user tapping on a notification (foreground or background)
    this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      this.handleResponse(response).catch(error => {
        console.error('[notifications] failed to handle notification response:', error);
      });
    });

    // OS-rotated device push tokens invalidate the previously issued Expo
    // push token, so re-derive and re-register it right away.
    this.pushTokenListener = Notifications.addPushTokenListener(() => {
      this.refreshTokenAndRegister().catch(error => {
        console.error('[notifications] failed to refresh rotated push token:', error);
      });
    });

    this.appStateListener = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        Notifications.setBadgeCountAsync(0).catch(error => {
          console.warn('[notifications] failed to clear badge on foreground:', error);
        });
      }
    });
  }

  private async refreshTokenAndRegister(): Promise<void> {
    const token = await this.getExpoPushToken();
    if (token && this.lastRegistered?.userId) {
      await this.registerIfChanged(token, this.lastRegistered.userId);
    }
  }

  private async handleResponse(response: Notifications.NotificationResponse): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(0);
    } catch (error) {
      console.warn('[notifications] failed to clear badge on tap:', error);
    }

    this.lastHandledResponseId = response.notification.request.identifier;
    this.routeToPayload(response.notification.request.content.data);
  }

  private async routeInitialNotificationResponse(): Promise<void> {
    try {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (!response) return;

      const id = response.notification.request.identifier;
      if (id && id === this.lastHandledResponseId) return;

      this.lastHandledResponseId = id;
      this.routeToPayload(response.notification.request.content.data);
    } catch (error) {
      console.warn('[notifications] failed to read cold-start notification response:', error);
    }
  }

  private routeToPayload(rawData: unknown): void {
    const path = resolveDeepLinkPath(rawData);
    if (!path) return;

    if (this.navigationHandler) {
      const [screen, ...rest] = path.split('/');
      this.navigationHandler({ screen, params: { path, segments: rest } });
      return;
    }

    // No navigation ref has been wired up (nothing registers one yet), so we
    // fall back to opening our own app-scheme deep link. RootNavigator's
    // `linking` config already parses `wagerpals://events/:eventId` etc.,
    // and going through Linking.openURL lets the OS route it the same way a
    // tapped universal link would, without this file needing a ref into the
    // navigation tree.
    try {
      const url = Linking.createURL(path);
      Linking.openURL(url).catch(error => {
        console.error('[notifications] failed to open deep link:', error);
      });
    } catch (error) {
      console.error('[notifications] failed to build deep link:', error);
    }
  }

  setNavigationHandler(handler: NavigationHandler | null): void {
    this.navigationHandler = handler;
  }

  private async registerIfChanged(token: string, userId: string): Promise<void> {
    if (this.lastRegistered && this.lastRegistered.token === token && this.lastRegistered.userId === userId) {
      return;
    }
    await this.subscribeToPush(token, userId);
    this.lastRegistered = { token, userId };
  }

  async subscribeToPush(token: string, userId: string): Promise<void> {
    try {
      await apiService.subscribeToPush({ token, userId });
    } catch (error) {
      console.error('[notifications] failed to subscribe to push notifications:', error);
    }
  }

  async unsubscribeFromPush(): Promise<void> {
    if (this.expoPushToken) {
      try {
        await apiService.unsubscribeFromPush(this.expoPushToken);
      } catch (error) {
        console.error('[notifications] failed to unsubscribe from push notifications:', error);
      }
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.unsubscribeFromPush();
    } catch (error) {
      console.error('[notifications] failed to unsubscribe during sign out:', error);
    }
    this.lastRegistered = null;
    try {
      await Notifications.setBadgeCountAsync(0);
    } catch (error) {
      console.warn('[notifications] failed to clear badge on sign out:', error);
    }
  }

  cleanup(): void {
    try {
      this.notificationListener?.remove();
      this.responseListener?.remove();
      this.pushTokenListener?.remove();
      this.appStateListener?.remove();
    } catch (error) {
      console.warn('[notifications] error during listener cleanup:', error);
    }
    this.notificationListener = null;
    this.responseListener = null;
    this.pushTokenListener = null;
    this.appStateListener = null;
    this.listenersReady = false;
  }

  // Send a local notification (for testing)
  async sendLocalNotification(title: string, body: string, data?: NotificationPayloadData): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('[notifications] failed to schedule local notification:', error);
    }
  }
}

export default new NotificationService();

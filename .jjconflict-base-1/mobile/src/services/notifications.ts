// Push notification service using Expo Notifications
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import apiService from './api';

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
  private notificationListener: any = null;
  private responseListener: any = null;
  private initialized = false;

  async init(userId?: string) {
    // Only do permissions + listeners once
    if (!this.initialized) {
      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return null;
      }

      // Get the token
      const token = await this.getExpoPushToken();

      // Set up listeners
      this.setupListeners();

      this.initialized = true;

      // Subscribe if we have a user
      if (token && userId) {
        await this.subscribeToPush(token, userId);
      }

      return token;
    }

    // Already initialized: ensure subscription if we have token + user
    if (this.expoPushToken && userId) {
      await this.subscribeToPush(this.expoPushToken, userId);
    }
    return this.expoPushToken;
  }

  async getExpoPushToken(): Promise<string | null> {
    if (!Device.isDevice) {
      return null;
    }

    try {
      // Prefer env, then app config (works in Expo Go and dev builds)
      const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
        || (Constants?.expoConfig as any)?.extra?.eas?.projectId
        || (Constants as any)?.easConfig?.projectId;
      const token = projectId
        ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
        : (await Notifications.getExpoPushTokenAsync()).data;
      this.expoPushToken = token;
      return token;
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }
  }

  private setupListeners() {
    // Handle notifications received while app is in foreground
    this.notificationListener = Notifications.addNotificationReceivedListener(
      _notification => {
        // Notification received in foreground
      }
    );

    // Handle user tapping on notification
    this.responseListener = Notifications.addNotificationResponseReceivedListener(
      response => {
        const data = response.notification.request.content.data;
        
        // Handle navigation based on notification data
        if (data.url) {
          // Navigate to the URL in data
          // This will be implemented in the navigation setup
        }
      }
    );
  }

  async subscribeToPush(token: string, userId: string) {
    try {
      await apiService.subscribeToPush({ token, userId });
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
    }
  }

  async unsubscribeFromPush() {
    if (this.expoPushToken) {
      try {
        await apiService.unsubscribeFromPush(this.expoPushToken);
      } catch (error) {
        console.error('Failed to unsubscribe from push notifications:', error);
      }
    }
  }

  cleanup() {
    if (this.notificationListener?.remove) {
      this.notificationListener.remove();
    }
    if (this.responseListener?.remove) {
      this.responseListener.remove();
    }
    this.initialized = false;
  }

  // Send a local notification (for testing)
  async sendLocalNotification(title: string, body: string, data?: any) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
      },
      trigger: null, // Send immediately
    });
  }
}

export default new NotificationService();




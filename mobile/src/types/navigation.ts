// Navigation types and stack paramaters
import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Auth: undefined;
  UsernameSetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  GroupDetail: { groupId: string };
  EventDetail: { eventId: string };
  CreateEvent: { groupId: string };
  GroupAdmin: { groupId: string };
  JoinGroup: { groupId?: string };
  Profile: undefined;
  EditUsername: undefined;
  // Audit finding D1: a bare `https://wagerpals.io/invite` deep link (no query
  // params at all) used to crash here because every field was required. All
  // fields are optional now so the screen can render a sensible empty state
  // instead of the navigator throwing on a missing param.
  CreateEventFromInvite: { title?: string; sideA?: string; sideB?: string; pick?: string; amount?: string; groupId?: string } | undefined;
  Wallet: undefined;
  NotificationPreferences: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Activity: undefined;
  Explore: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}





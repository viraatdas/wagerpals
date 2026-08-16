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
  CreateEventFromInvite: { title: string; sideA: string; sideB: string; pick?: string; amount?: string };
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





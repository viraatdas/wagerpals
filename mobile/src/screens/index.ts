// Screen barrel.
//
// This file used to contain two placeholder re-exports left over from when
// CreateEvent and EventDetail were unimplemented:
//
//   export { default as CreateEventScreen } from './GroupAdminScreen';
//   export { default as EventDetailScreen } from './GroupAdminScreen';
//
// Both screens have existed for a long time, so anyone who imported
// `CreateEventScreen` from '../screens' silently got the *group admin* screen
// instead. RootNavigator imports each screen by path and never touched this
// barrel, which is the only reason it never shipped as a visible bug. The
// aliases are removed rather than corrected-in-place so the wrong name can't
// be resurrected by autocomplete.
export { default as ActivityScreen } from './ActivityScreen';
export { default as AuthScreen } from './AuthScreen';
export { default as CreateEventFromInviteScreen } from './CreateEventFromInviteScreen';
export { default as CreateEventScreen } from './CreateEventScreen';
export { default as EditUsernameScreen } from './EditUsernameScreen';
export { default as EventDetailScreen } from './EventDetailScreen';
export { default as ExploreScreen } from './ExploreScreen';
export { default as GroupAdminScreen } from './GroupAdminScreen';
export { default as GroupDetailScreen } from './GroupDetailScreen';
export { default as HomeScreen } from './HomeScreen';
export { default as JoinGroupScreen } from './JoinGroupScreen';
export { default as NotificationPreferencesScreen } from './NotificationPreferencesScreen';
export { default as ProfileScreen } from './ProfileScreen';
export { default as UsernameSetupScreen } from './UsernameSetupScreen';
export { default as WalletScreen } from './WalletScreen';

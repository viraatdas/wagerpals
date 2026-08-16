import * as Haptics from 'expo-haptics';

/** Light tap — for button presses, tab switches, toggles */
export function tapLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Medium tap — for confirming selections, placing bets */
export function tapMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** Heavy tap — for destructive actions, important confirmations */
export function tapHeavy() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/** Success — for bet placed, event created, group joined */
export function success() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Error — for validation failures, insufficient balance */
export function error() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

/** Warning — for late bets, pending approvals */
export function warning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

/** Selection tick — for scrolling through pickers, side selection */
export function selectionTick() {
  Haptics.selectionAsync();
}

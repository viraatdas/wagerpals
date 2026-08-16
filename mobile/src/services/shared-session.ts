// Shared Keychain session bridge.
//
// The main WagerPals app and the iMessage extension (com.wagerpals.app.messages)
// are separate processes/bundles, so the only way for the extension to read the
// signed-in user's Stack Auth session is via a Keychain *access group* shared
// between both targets. This module owns every read/write against that shared
// location so callers (auth.ts) never have to think about SecureStore options.
//
// The extension's Swift reader hardcodes:
//   - kSecAttrService  = "wagerpals:no-auth"   (== `${keychainService}:no-auth`,
//     the "no-auth" suffix comes from expo-secure-store when `requireAuthentication`
//     is left unset/false — see SecureStoreModule.swift `query(...)`)
//   - kSecAttrAccessGroup = "3C4383262W.com.wagerpals.shared"
// Do not change KEYCHAIN_SERVICE / KEYCHAIN_ACCESS_GROUP without updating the
// extension side too.
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

export const KEYCHAIN_SERVICE: string =
  (typeof extra.keychainService === 'string' && extra.keychainService) || 'wagerpals';

// Access groups are an iOS-only Keychain concept — there is nothing to share on
// Android/web, and passing a value there would be meaningless (and expo-secure-store
// simply ignores it off-iOS, but we keep this explicit for clarity/testability).
export const KEYCHAIN_ACCESS_GROUP: string | undefined =
  Platform.OS === 'ios'
    ? (typeof extra.keychainAccessGroup === 'string' && extra.keychainAccessGroup) ||
      '3C4383262W.com.wagerpals.shared'
    : undefined;

export type SharedIdentity = {
  id: string;
  username: string;
  displayName: string | null;
};

const SHARED_SESSION_KEY = 'sharedSession';
const LEGACY_KEYS = ['accessToken', 'refreshToken', 'user'] as const;

function sharedOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainService: KEYCHAIN_SERVICE,
    accessGroup: KEYCHAIN_ACCESS_GROUP,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  };
}

export async function setSharedItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, sharedOptions());
  } catch (error) {
    console.warn(`[shared-session] Failed to write "${key}" to shared keychain:`, error);
  }
}

export async function getSharedItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, sharedOptions());
  } catch (error) {
    console.warn(`[shared-session] Failed to read "${key}" from shared keychain:`, error);
    return null;
  }
}

export async function deleteSharedItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, sharedOptions());
  } catch (error) {
    console.warn(`[shared-session] Failed to delete "${key}" from shared keychain:`, error);
  }
}

export async function publishSharedIdentity(identity: SharedIdentity): Promise<void> {
  await setSharedItem(SHARED_SESSION_KEY, JSON.stringify(identity));
}

// Wipes every shared key on sign-out so the extension loses access along with
// the main app. This must be airtight: an extension still holding a valid
// token after the user signs out of the app is a real security bug.
export async function clearSharedSession(): Promise<void> {
  await Promise.all([
    ...LEGACY_KEYS.map((key) => deleteSharedItem(key)),
    deleteSharedItem(SHARED_SESSION_KEY),
  ]);
}

// One-time migration from the pre-sharing SecureStore location (default
// `keychainService: 'app'`, no access group) to the shared one. Must be called
// before anything reads the new location, otherwise an already-signed-in user
// would appear signed out.
//
// - Idempotent: safe to call on every app start.
// - Never throws: a keychain failure must never block sign-in / app startup.
// - Never deletes the legacy copy unless the write to the new location
//   actually succeeded, so a failed migration is retryable next launch.
export async function migrateLegacySecureStore(): Promise<boolean> {
  let migratedAnything = false;

  for (const key of LEGACY_KEYS) {
    try {
      // New location already has a value — nothing to migrate for this key.
      const existing = await getSharedItem(key);
      if (existing !== null) {
        continue;
      }

      // Legacy read uses no options at all, matching the pre-sharing calls
      // (`SecureStore.getItemAsync(key)`), i.e. keychainService = 'app'.
      const legacyValue = await SecureStore.getItemAsync(key);
      if (legacyValue === null) {
        continue;
      }

      await SecureStore.setItemAsync(key, legacyValue, sharedOptions());
      // The value now lives at the new location — this counts as "migrated"
      // even if the legacy delete below fails; we only need to guarantee we
      // never delete the legacy copy BEFORE the new write succeeds.
      migratedAnything = true;

      try {
        await SecureStore.deleteItemAsync(key);
      } catch (deleteError) {
        console.warn(
          `[shared-session] Migrated "${key}" but failed to delete the legacy copy (will retry next launch):`,
          deleteError
        );
      }
    } catch (error) {
      console.warn(`[shared-session] Failed to migrate legacy key "${key}":`, error);
      // The write to the new location failed (or the legacy read failed) —
      // leave the legacy item in place so the next launch, or the normal
      // legacy-location fallback, can still recover it.
    }
  }

  return migratedAnything;
}

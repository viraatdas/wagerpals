import Foundation
import Security

/// Reads the main WagerPals app's Stack Auth session out of the shared
/// Keychain access group written to by `expo-secure-store` (v15.0.8) on the
/// main app side. See `mobile/src/services/shared-session.ts` for the write
/// path — this is intentionally the mirror-image reader.
///
/// expo-secure-store's on-disk layout (`SecureStoreModule.swift`, default
/// `requireAuthentication: false`) is:
///   - kSecClass          = kSecClassGenericPassword
///   - kSecAttrService    = "<keychainService>:no-auth"
///   - kSecAttrAccount    = Data(key.utf8)   (Data, not String)
///   - kSecAttrGeneric    = Data(key.utf8)
///   - kSecAttrAccessGroup = WagerConfig.keychainAccessGroup
///   - value in kSecValueData, UTF-8 bytes
enum WagerSessionStore {

    // MARK: - Raw keychain read

    private static func query(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Data(account.utf8),
            kSecAttrAccessGroup as String: WagerConfig.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
    }

    private static func read(service: String, account: String) -> String? {
        var item: AnyObject?
        let status = SecItemCopyMatching(query(service: service, account: account) as CFDictionary, &item)

        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                return nil
            }
            return value
        case errSecItemNotFound:
            return nil
        default:
            NSLog(
                "WagerSessionStore: keychain read failed (service=%@ account=%@ status=%d)",
                service, account, status
            )
            return nil
        }
    }

    /// Tries the modern `expo-secure-store` "no-auth" service first, then a
    /// bare service name (pre-`requireAuthentication`-suffix legacy data),
    /// then the "auth" suffix, in case `requireAuthentication` is ever
    /// flipped on for these keys on the app side.
    static func string(forKey key: String) -> String? {
        let baseService = WagerConfig.keychainService
        let servicesToTry = [
            "\(baseService):no-auth",
            baseService,
            "\(baseService):auth",
        ]
        for service in servicesToTry {
            if let value = read(service: service, account: key) {
                return value
            }
        }
        return nil
    }

    // MARK: - Session accessors

    static func accessToken() -> String? {
        string(forKey: "accessToken")
    }

    static func refreshToken() -> String? {
        string(forKey: "refreshToken")
    }

    static var isSignedIn: Bool {
        accessToken() != nil
    }

    /// The shape written by the main app to `user` — Stack Auth's identity,
    /// camelCase (matches `AuthUser` in `mobile/src/types/index.ts`).
    private struct LegacyAppUser: Decodable {
        let id: String
        let email: String?
        let displayName: String?
        let primaryEmail: String?
    }

    /// The shape written by the main app to `sharedSession` specifically for
    /// this extension — camelCase, NOT the server's snake_case wire format
    /// (see `SharedIdentity` in `mobile/src/services/shared-session.ts`).
    private struct SharedIdentityJSON: Decodable {
        let id: String
        let username: String
        let displayName: String?
    }

    /// Decodes `sharedSession` when present; falls back to the older `user`
    /// blob (which has no `username`, so email/primaryEmail/id stand in).
    static func cachedIdentity() -> WagerSessionUser? {
        if let json = string(forKey: "sharedSession"),
           let data = json.data(using: .utf8),
           let shared = try? JSONDecoder().decode(SharedIdentityJSON.self, from: data) {
            return WagerSessionUser(id: shared.id, username: shared.username, displayName: shared.displayName)
        }

        if let json = string(forKey: "user"),
           let data = json.data(using: .utf8),
           let legacy = try? JSONDecoder().decode(LegacyAppUser.self, from: data) {
            let username = legacy.email ?? legacy.primaryEmail ?? legacy.id
            return WagerSessionUser(id: legacy.id, username: username, displayName: legacy.displayName)
        }

        return nil
    }
}

/// Small App Group–backed cache so the extension can render something useful
/// (last-used group, group list) before the network round trip completes.
/// This is the entire reason the extension carries an App Group entitlement.
enum WagerLocalCache {
    private static let lastGroupIdKey = "WagerLastGroupId"
    private static let cachedGroupsKey = "WagerCachedGroups"

    static var lastGroupId: String? {
        get { WagerConfig.sharedDefaults?.string(forKey: lastGroupIdKey) }
        set { WagerConfig.sharedDefaults?.set(newValue, forKey: lastGroupIdKey) }
    }

    static func cacheGroups(_ groups: [WagerGroup]) {
        guard let data = try? JSONEncoder().encode(groups) else { return }
        WagerConfig.sharedDefaults?.set(data, forKey: cachedGroupsKey)
    }

    static func cachedGroups() -> [WagerGroup] {
        guard let data = WagerConfig.sharedDefaults?.data(forKey: cachedGroupsKey) else {
            return []
        }
        return (try? JSONDecoder().decode([WagerGroup].self, from: data)) ?? []
    }
}

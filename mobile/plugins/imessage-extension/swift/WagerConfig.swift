import Foundation

/// Build-time configuration for the WagerPals iMessage extension.
///
/// The Expo config plugin (`withIMessageExtension.js`) writes these keys into
/// the extension's `Info.plist` at prebuild time. Every value here has a real,
/// working fallback so the extension still functions (against production)
/// even if a key is missing from the generated Info.plist.
enum WagerConfig {

    // MARK: - Raw Info.plist lookup

    private static var infoDictionary: [String: Any] {
        Bundle.main.infoDictionary ?? [:]
    }

    private static func stringValue(forKey key: String, fallback: String) -> String {
        guard let value = infoDictionary[key] as? String, !value.isEmpty else {
            return fallback
        }
        return value
    }

    // MARK: - Config values

    static let apiBaseURL: URL = {
        let raw = stringValue(forKey: "WPApiBaseURL", fallback: "https://wagerpals.io")
        return URL(string: raw) ?? URL(string: "https://wagerpals.io")!
    }()

    static let webBaseURL: URL = {
        let raw = stringValue(forKey: "WPWebBaseURL", fallback: "https://wagerpals.io")
        return URL(string: raw) ?? URL(string: "https://wagerpals.io")!
    }()

    static let appGroupId: String = stringValue(
        forKey: "WPAppGroup",
        fallback: "group.com.wagerpals.app"
    )

    static let keychainAccessGroup: String = stringValue(
        forKey: "WPKeychainAccessGroup",
        fallback: "3C4383262W.com.wagerpals.shared"
    )

    static let keychainService: String = stringValue(
        forKey: "WPKeychainService",
        fallback: "wagerpals"
    )

    static let appStoreId: String = stringValue(
        forKey: "WPAppStoreId",
        fallback: "6754625373"
    )

    // MARK: - Derived helpers

    /// The App Group's shared `UserDefaults` suite, used for the small local
    /// cache the extension keeps (last-used group, cached group list). `nil`
    /// if the suite can't be opened (e.g. missing entitlement in a debug build).
    static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func appStoreURL() -> URL {
        URL(string: "https://apps.apple.com/app/id\(appStoreId)")
            ?? URL(string: "https://apps.apple.com")!
    }

    /// Builds a shareable invite link for a wager event, e.g.
    /// `https://wagerpals.io/invite?e=<eventId>&t=<shareToken>`.
    static func inviteURL(eventId: String, shareToken: String?) -> URL {
        var components = URLComponents(
            url: webBaseURL.appendingPathComponent("invite"),
            resolvingAgainstBaseURL: false
        ) ?? URLComponents()

        var queryItems = [URLQueryItem(name: "e", value: eventId)]
        if let shareToken = shareToken, !shareToken.isEmpty {
            queryItems.append(URLQueryItem(name: "t", value: shareToken))
        }
        components.queryItems = queryItems

        return components.url ?? webBaseURL.appendingPathComponent("invite")
    }
}

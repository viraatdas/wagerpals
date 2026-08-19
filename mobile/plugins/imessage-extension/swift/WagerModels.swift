import Foundation

// MARK: - Tolerant decoding helpers

/// Decodes a value that the server may emit as either a JSON number or a
/// numeric string (large millisecond timestamps have been seen stringified
/// by some intermediate JSON serializers).
private extension KeyedDecodingContainer {
    func decodeTolerantDouble(forKey key: Key) throws -> Double {
        if let value = try? decode(Double.self, forKey: key) {
            return value
        }
        let stringValue = try decode(String.self, forKey: key)
        guard let value = Double(stringValue) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected a numeric value or a numeric string, got \"\(stringValue)\""
            )
        }
        return value
    }
}

/// Renders an optional value as its wrapped value, or `NSNull()` when absent,
/// for use in `JSONSerialization`-compatible `[String: Any]` dictionaries
/// (plain `nil` is not a legal value inside such a dictionary).
private func jsonValue<T>(_ value: T?) -> Any {
    if let value = value {
        return value
    }
    return NSNull()
}

// MARK: - Payment

enum WagerPaymentType: String, Codable, Hashable, Sendable {
    case none
    case cash
}

// MARK: - Group / session

/// One active member of a group, as returned by GET /api/imessage/session.
/// Deliberately just id + username: the extension needs a name to show in the
/// subject picker and an id to send back, and nothing else about these people
/// is the extension's business.
struct WagerGroupMember: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let username: String
}

struct WagerGroup: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let isPublic: Bool
    let members: [WagerGroupMember]

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case isPublic = "is_public"
        case members
    }

    init(id: String, name: String, isPublic: Bool, members: [WagerGroupMember] = []) {
        self.id = id
        self.name = name
        self.isPublic = isPublic
        self.members = members
    }

    // Hand-written so `members` DEFAULTS to [] when the key is absent.
    // Synthesized Decodable throws keyNotFound on a missing non-optional
    // array, which matters here for a concrete reason: WagerLocalCache
    // persists groups into the App Group container, and a cache written
    // before `members` existed would otherwise fail to decode — and
    // cachedGroups()'s `try? ... ?? []` fallback would silently discard the
    // ENTIRE cached group list rather than just backfilling the new field.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        isPublic = try container.decode(Bool.self, forKey: .isPublic)
        members = try container.decodeIfPresent([WagerGroupMember].self, forKey: .members) ?? []
    }
}

struct WagerSessionUser: Codable, Hashable, Sendable {
    let id: String
    let username: String
    let displayName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case displayName = "display_name"
    }
}

struct WagerSessionPayload: Codable, Hashable, Sendable {
    let user: WagerSessionUser
    let groups: [WagerGroup]
}

// MARK: - Wager preview

struct WagerPreview: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let sideA: String
    let sideB: String
    /// Milliseconds since epoch.
    let endTime: Double
    /// "active" | "resolved" (server may also send other terminal states,
    /// e.g. "cancelled" — treat anything that isn't "active" as not open).
    let status: String
    let winningSide: String?
    let paymentType: WagerPaymentType
    let stakeAmount: Double?
    let totalBets: Int
    let totalParticipants: Int
    let sideACount: Int
    let sideBCount: Int
    /// `nil` unless a valid share token was presented with the request.
    let sideATotal: Double?
    let sideBTotal: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case sideA = "side_a"
        case sideB = "side_b"
        case endTime = "end_time"
        case status
        case winningSide = "winning_side"
        case paymentType = "payment_type"
        case stakeAmount = "stake_amount"
        case totalBets = "total_bets"
        case totalParticipants = "total_participants"
        case sideACount = "side_a_count"
        case sideBCount = "side_b_count"
        case sideATotal = "side_a_total"
        case sideBTotal = "side_b_total"
    }

    init(
        id: String,
        title: String,
        sideA: String,
        sideB: String,
        endTime: Double,
        status: String,
        winningSide: String?,
        paymentType: WagerPaymentType,
        stakeAmount: Double?,
        totalBets: Int,
        totalParticipants: Int,
        sideACount: Int,
        sideBCount: Int,
        sideATotal: Double?,
        sideBTotal: Double?
    ) {
        self.id = id
        self.title = title
        self.sideA = sideA
        self.sideB = sideB
        self.endTime = endTime
        self.status = status
        self.winningSide = winningSide
        self.paymentType = paymentType
        self.stakeAmount = stakeAmount
        self.totalBets = totalBets
        self.totalParticipants = totalParticipants
        self.sideACount = sideACount
        self.sideBCount = sideBCount
        self.sideATotal = sideATotal
        self.sideBTotal = sideBTotal
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        sideA = try container.decode(String.self, forKey: .sideA)
        sideB = try container.decode(String.self, forKey: .sideB)
        endTime = try container.decodeTolerantDouble(forKey: .endTime)
        status = try container.decode(String.self, forKey: .status)
        winningSide = try container.decodeIfPresent(String.self, forKey: .winningSide)
        paymentType = try container.decode(WagerPaymentType.self, forKey: .paymentType)
        stakeAmount = try container.decodeIfPresent(Double.self, forKey: .stakeAmount)
        totalBets = try container.decode(Int.self, forKey: .totalBets)
        totalParticipants = try container.decode(Int.self, forKey: .totalParticipants)
        sideACount = try container.decode(Int.self, forKey: .sideACount)
        sideBCount = try container.decode(Int.self, forKey: .sideBCount)
        sideATotal = try container.decodeIfPresent(Double.self, forKey: .sideATotal)
        sideBTotal = try container.decodeIfPresent(Double.self, forKey: .sideBTotal)
    }
}

extension WagerPreview {
    var endDate: Date {
        Date(timeIntervalSince1970: endTime / 1000)
    }

    var isOpen: Bool {
        status == "active" && endDate > Date()
    }

    /// "closes in 3h" / "closed" / "resolved: <side>"
    var deadlineText: String {
        if status == "resolved" {
            return "resolved: \(winningSide ?? sideA)"
        }
        guard endDate > Date() else {
            return "closed"
        }
        let interval = endDate.timeIntervalSinceNow
        if interval >= 86_400 {
            return "closes in \(Int((interval / 86_400).rounded(.down)))d"
        } else if interval >= 3_600 {
            return "closes in \(Int((interval / 3_600).rounded(.down)))h"
        } else if interval >= 60 {
            return "closes in \(Int((interval / 60).rounded(.down)))m"
        } else {
            return "closes in <1m"
        }
    }

    /// "4 vs 2"
    var splitText: String {
        "\(sideACount) vs \(sideBCount)"
    }

    var stakeText: String? {
        guard paymentType == .cash, let stakeAmount = stakeAmount else { return nil }
        return WagerPreview.stakeFormatter.string(from: NSNumber(value: stakeAmount))
            ?? "$\(stakeAmount)"
    }

    private static let stakeFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 0
        return formatter
    }()
}

// MARK: - Create bet

/// Not `Codable` — serialized explicitly via `jsonBody()` so the wire format
/// (snake_case keys, explicit JSON `null` for absent optionals) is exact.
struct WagerCreateRequest: Sendable {
    var groupId: String
    var title: String
    var sideA: String
    var sideB: String
    /// Milliseconds since epoch.
    var endTime: Double
    var paymentType: WagerPaymentType
    var stakeAmount: Double?
    var subjectUserId: String?
    var notifySubject: Bool
    var side: String?
    var amount: Double?

    /// Produces exactly:
    /// `{group_id, title, side_a, side_b, end_time, payment_type, stake_amount,
    ///   subject_user_id, notify_subject, side, amount}`
    /// with JSON `null` for every absent optional.
    func jsonBody() -> [String: Any] {
        [
            "group_id": groupId,
            "title": title,
            "side_a": sideA,
            "side_b": sideB,
            "end_time": endTime,
            "payment_type": paymentType.rawValue,
            "stake_amount": jsonValue(stakeAmount),
            "subject_user_id": jsonValue(subjectUserId),
            "notify_subject": notifySubject,
            "side": jsonValue(side),
            "amount": jsonValue(amount),
        ]
    }
}

struct WagerCreateResponse: Codable, Hashable, Sendable {
    let eventId: String
    /// `nil` when the server has no share-signing secret configured — this
    /// is a legitimate, non-error response shape, not a decode failure.
    let shareToken: String?
    let shareURL: URL
    let preview: WagerPreview

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case shareToken = "share_token"
        case shareURL = "share_url"
        case preview
    }
}

struct WagerTakeSideResponse: Codable, Hashable, Sendable {
    let betId: String
    let preview: WagerPreview

    enum CodingKeys: String, CodingKey {
        case betId = "bet_id"
        case preview
    }
}

// MARK: - Live wagers (compact-mode quick strip)

/// One side's aggregate stake, as returned inside `side_stats` by
/// GET /api/events?groupId=. Plain numbers on the wire (not the
/// stringified-timestamp case `decodeTolerantDouble` guards against), so a
/// synthesized `Codable` is enough.
struct WagerSideStat: Codable, Hashable, Sendable {
    let count: Int
    let total: Double
}

struct WagerResolutionSummary: Codable, Hashable, Sendable {
    let winningSide: String

    enum CodingKeys: String, CodingKey {
        case winningSide = "winning_side"
    }
}

/// One event as returned by `GET /api/events?groupId=<id>` (the same route
/// the main app's board uses) — richer than `WagerPreview` (keyed
/// `side_stats` rather than flat `side_a_count`/`side_b_count`, a nested
/// `resolution`), so this decodes the wire shape directly and exposes a
/// `.preview` computed property to bridge into the shared `WagerPreview`
/// type the rest of the extension (bubble composer, TakeSideView) already
/// understands.
struct WagerEventSummary: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let sideA: String
    let sideB: String
    let groupId: String
    /// "active" | "resolved" (see `WagerPreview.status`).
    let status: String
    let paymentType: WagerPaymentType
    let stakeAmount: Double?
    /// Milliseconds since epoch.
    let endTime: Double
    let totalBets: Int
    let totalParticipants: Int
    let sideStats: [String: WagerSideStat]
    let resolution: WagerResolutionSummary?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case sideA = "side_a"
        case sideB = "side_b"
        case groupId = "group_id"
        case status
        case paymentType = "payment_type"
        case stakeAmount = "stake_amount"
        case endTime = "end_time"
        case totalBets = "total_bets"
        case totalParticipants = "total_participants"
        case sideStats = "side_stats"
        case resolution
    }

    // Hand-written (rather than synthesized) so a field this extension
    // doesn't strictly need never turns a whole card into a decode failure —
    // same defensive posture as `WagerGroup.init(from:)` above, and the same
    // reason `WagerLocalCache` can safely persist these between launches.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        sideA = try container.decode(String.self, forKey: .sideA)
        sideB = try container.decode(String.self, forKey: .sideB)
        groupId = try container.decode(String.self, forKey: .groupId)
        status = try container.decode(String.self, forKey: .status)
        paymentType = (try? container.decode(WagerPaymentType.self, forKey: .paymentType)) ?? .none
        stakeAmount = try container.decodeIfPresent(Double.self, forKey: .stakeAmount)
        endTime = try container.decodeTolerantDouble(forKey: .endTime)
        totalBets = (try? container.decode(Int.self, forKey: .totalBets)) ?? 0
        totalParticipants = (try? container.decode(Int.self, forKey: .totalParticipants)) ?? 0
        sideStats = (try? container.decode([String: WagerSideStat].self, forKey: .sideStats)) ?? [:]
        resolution = try? container.decodeIfPresent(WagerResolutionSummary.self, forKey: .resolution)
    }
}

extension WagerEventSummary {
    var isOpen: Bool { status == "active" }

    var preview: WagerPreview {
        let statA = sideStats[sideA]
        let statB = sideStats[sideB]
        return WagerPreview(
            id: id,
            title: title,
            sideA: sideA,
            sideB: sideB,
            endTime: endTime,
            status: status,
            winningSide: resolution?.winningSide,
            paymentType: paymentType,
            stakeAmount: stakeAmount,
            totalBets: totalBets,
            totalParticipants: totalParticipants,
            sideACount: statA?.count ?? 0,
            sideBCount: statB?.count ?? 0,
            sideATotal: statA?.total,
            sideBTotal: statB?.total
        )
    }
}

import Foundation

enum WagerAPIError: Error, LocalizedError {
    case notSignedIn
    case http(status: Int, message: String)
    case transport(Error)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .notSignedIn:
            return "Sign in to WagerPals in the main app first."
        case .http(let status, let message):
            return message.isEmpty ? HTTPURLResponse.localizedString(forStatusCode: status) : message
        case .transport(let error):
            return error.localizedDescription
        case .decoding:
            return "Couldn't understand the server's response."
        }
    }
}

/// Thin `async`/`await` client over `URLSession`. Every authenticated
/// request sends `Authorization: Bearer <accessToken>` and, when available,
/// `x-stack-refresh-token: <refreshToken>` — the two headers `lib/auth.ts`
/// accepts for the mobile auth path.
enum WagerAPI {

    private static let urlSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    /// No global key strategy — every model carries explicit `CodingKeys`.
    private static let decoder = JSONDecoder()

    private struct ErrorBody: Decodable {
        let error: String?
        let code: String?
    }

    // MARK: - Request building

    private static func makeRequest(
        path: String,
        method: String,
        queryItems: [URLQueryItem]? = nil,
        authRequired: Bool
    ) throws -> URLRequest {
        var components = URLComponents(
            url: WagerConfig.apiBaseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if let queryItems = queryItems, !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else {
            throw WagerAPIError.transport(URLError(.badURL))
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let accessToken = WagerSessionStore.accessToken()
        if authRequired {
            guard let accessToken = accessToken else {
                throw WagerAPIError.notSignedIn
            }
            applyAuthHeaders(to: &request, accessToken: accessToken)
        } else if let accessToken = accessToken {
            // Public endpoint — attach auth opportunistically when we have
            // it (lets the server personalize the response), but never
            // require it.
            applyAuthHeaders(to: &request, accessToken: accessToken)
        }

        return request
    }

    private static func applyAuthHeaders(to request: inout URLRequest, accessToken: String) {
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        if let refreshToken = WagerSessionStore.refreshToken() {
            request.setValue(refreshToken, forHTTPHeaderField: "x-stack-refresh-token")
        }
    }

    private static func jsonData(_ object: [String: Any]) throws -> Data {
        do {
            return try JSONSerialization.data(withJSONObject: object)
        } catch {
            throw WagerAPIError.transport(error)
        }
    }

    // MARK: - Networking core

    private static func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw WagerAPIError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WagerAPIError.transport(URLError(.badServerResponse))
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let serverMessage = (try? decoder.decode(ErrorBody.self, from: data))?.error
            let message = serverMessage ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw WagerAPIError.http(status: httpResponse.statusCode, message: message)
        }

        return data
    }

    private static func decodeResponse<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw WagerAPIError.decoding(error)
        }
    }

    // MARK: - Endpoints

    /// GET `<api>/api/imessage/session` (auth required).
    static func session() async throws -> WagerSessionPayload {
        let request = try makeRequest(path: "/api/imessage/session", method: "GET", authRequired: true)
        let data = try await send(request)
        return try decodeResponse(WagerSessionPayload.self, from: data)
    }

    /// POST `<api>/api/imessage/bets` (auth required).
    static func createBet(_ createRequest: WagerCreateRequest) async throws -> WagerCreateResponse {
        var request = try makeRequest(path: "/api/imessage/bets", method: "POST", authRequired: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try jsonData(createRequest.jsonBody())
        let data = try await send(request)
        return try decodeResponse(WagerCreateResponse.self, from: data)
    }

    /// GET `<api>/api/events/preview?id=<id>[&t=<token>]` — PUBLIC, sends
    /// auth when available but does not require it.
    static func preview(eventId: String, shareToken: String?) async throws -> WagerPreview {
        var queryItems = [URLQueryItem(name: "id", value: eventId)]
        if let shareToken = shareToken, !shareToken.isEmpty {
            queryItems.append(URLQueryItem(name: "t", value: shareToken))
        }
        let request = try makeRequest(
            path: "/api/events/preview",
            method: "GET",
            queryItems: queryItems,
            authRequired: false
        )
        let data = try await send(request)
        return try decodeResponse(WagerPreview.self, from: data)
    }

    /// POST `<api>/api/imessage/bets/side` (auth required) with body
    /// `{event_id, side, amount, share_token}`.
    static func takeSide(
        eventId: String,
        side: String,
        amount: Double,
        shareToken: String?
    ) async throws -> WagerTakeSideResponse {
        var request = try makeRequest(path: "/api/imessage/bets/side", method: "POST", authRequired: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "event_id": eventId,
            "side": side,
            "amount": amount,
            "share_token": shareToken ?? NSNull(),
        ]
        request.httpBody = try jsonData(body)
        let data = try await send(request)
        return try decodeResponse(WagerTakeSideResponse.self, from: data)
    }

    /// GET `<api>/api/events?groupId=<id>` — the same endpoint the main
    /// app's board uses to list a group's wagers, reused here (rather than a
    /// new server route) to power the compact-mode quick strip. Public, but
    /// sends auth opportunistically so the server can apply the R4
    /// "quiet bet" visibility rule for the signed-in caller.
    static func eventsForGroup(groupId: String) async throws -> [WagerEventSummary] {
        let request = try makeRequest(
            path: "/api/events",
            method: "GET",
            queryItems: [URLQueryItem(name: "groupId", value: groupId)],
            authRequired: false
        )
        let data = try await send(request)
        return try decodeResponse([WagerEventSummary].self, from: data)
    }
}

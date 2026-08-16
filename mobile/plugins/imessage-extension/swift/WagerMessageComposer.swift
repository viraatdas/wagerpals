import Messages
import UIKit

/// Owns MSMessage encoding/decoding for wager bubbles.
///
/// The bubble must mutate in place as people take sides — callers are
/// responsible for passing the same `MSSession` across every message for a
/// given wager (a fresh `MSSession()` spawns a brand-new bubble instead of
/// updating the existing one).
enum WagerMessageComposer {

    // MARK: - Query keys

    private enum Key {
        static let eventId = "e"
        static let shareToken = "t"
        static let title = "title"
        static let sideA = "a"
        static let sideB = "b"
        static let sideACount = "ac"
        static let sideBCount = "bc"
        static let sideATotal = "at"
        static let sideBTotal = "bt"
        static let endTime = "end"
        static let status = "st"
        static let winningSide = "ws"
        static let paymentType = "pt"
        static let stakeAmount = "sa"
        static let totalBets = "tb"
        static let totalParticipants = "tp"
    }

    // MARK: - Encode

    /// Builds the outgoing MSMessage for a wager. `session` must be the
    /// wager's existing `MSSession` when updating a bubble in place, or a
    /// fresh `MSSession()` only when sending a brand-new wager.
    static func message(for preview: WagerPreview, shareToken: String?, session: MSSession) -> MSMessage {
        let message = MSMessage(session: session)
        message.url = buildURL(preview: preview, shareToken: shareToken)
        message.layout = buildLayout(for: preview)
        message.summaryText = summary(for: preview)
        return message
    }

    private static func buildURL(preview: WagerPreview, shareToken: String?) -> URL? {
        guard var components = URLComponents(
            url: WagerConfig.webBaseURL.appendingPathComponent("invite"),
            resolvingAgainstBaseURL: false
        ) else { return nil }

        var items: [URLQueryItem] = [URLQueryItem(name: Key.eventId, value: preview.id)]

        if let shareToken = shareToken, !shareToken.isEmpty {
            items.append(URLQueryItem(name: Key.shareToken, value: shareToken))
        }

        items.append(contentsOf: [
            URLQueryItem(name: Key.title, value: preview.title),
            URLQueryItem(name: Key.sideA, value: preview.sideA),
            URLQueryItem(name: Key.sideB, value: preview.sideB),
            URLQueryItem(name: Key.sideACount, value: String(preview.sideACount)),
            URLQueryItem(name: Key.sideBCount, value: String(preview.sideBCount)),
        ])

        if let sideATotal = preview.sideATotal {
            items.append(URLQueryItem(name: Key.sideATotal, value: String(sideATotal)))
        }
        if let sideBTotal = preview.sideBTotal {
            items.append(URLQueryItem(name: Key.sideBTotal, value: String(sideBTotal)))
        }

        items.append(URLQueryItem(name: Key.endTime, value: String(preview.endTime)))
        items.append(URLQueryItem(name: Key.status, value: preview.status))

        if let winningSide = preview.winningSide {
            items.append(URLQueryItem(name: Key.winningSide, value: winningSide))
        }

        items.append(URLQueryItem(name: Key.paymentType, value: preview.paymentType.rawValue))

        if let stakeAmount = preview.stakeAmount {
            items.append(URLQueryItem(name: Key.stakeAmount, value: String(stakeAmount)))
        }

        items.append(URLQueryItem(name: Key.totalBets, value: String(preview.totalBets)))
        items.append(URLQueryItem(name: Key.totalParticipants, value: String(preview.totalParticipants)))

        components.queryItems = items
        return components.url
    }

    private static func buildLayout(for preview: WagerPreview) -> MSMessageTemplateLayout {
        let layout = MSMessageTemplateLayout()
        layout.caption = preview.title
        layout.subcaption = "\(preview.sideA)  vs  \(preview.sideB)"
        layout.trailingSubcaption = preview.deadlineText
        layout.trailingCaption = preview.splitText
        // If rendering fails for any reason, `layout.image` simply stays nil
        // rather than crashing the extension.
        if let image = renderCardImage(for: preview) {
            layout.image = image
        }
        return layout
    }

    private static func summary(for preview: WagerPreview) -> String {
        "\(preview.title) — \(preview.splitText) · \(preview.deadlineText)"
    }

    // MARK: - Decode

    /// Reverses `message(for:shareToken:session:)`. Returns `nil` only if the
    /// message has no URL, an unparseable URL, or is missing a required
    /// field — every `WagerPreview` field that was encoded is lossless.
    static func decode(from message: MSMessage) -> (preview: WagerPreview, shareToken: String?)? {
        guard let url = message.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }

        var values: [String: String] = [:]
        for item in components.queryItems ?? [] {
            guard let value = item.value else { continue }
            values[item.name] = value
        }

        guard let id = values[Key.eventId],
              let title = values[Key.title],
              let sideA = values[Key.sideA],
              let sideB = values[Key.sideB],
              let sideACountString = values[Key.sideACount], let sideACount = Int(sideACountString),
              let sideBCountString = values[Key.sideBCount], let sideBCount = Int(sideBCountString),
              let endTimeString = values[Key.endTime], let endTime = Double(endTimeString),
              let status = values[Key.status],
              let paymentTypeString = values[Key.paymentType], let paymentType = WagerPaymentType(rawValue: paymentTypeString),
              let totalBetsString = values[Key.totalBets], let totalBets = Int(totalBetsString),
              let totalParticipantsString = values[Key.totalParticipants], let totalParticipants = Int(totalParticipantsString)
        else {
            return nil
        }

        let sideATotal = values[Key.sideATotal].flatMap(Double.init)
        let sideBTotal = values[Key.sideBTotal].flatMap(Double.init)
        let stakeAmount = values[Key.stakeAmount].flatMap(Double.init)
        let winningSide = values[Key.winningSide]
        let shareToken = values[Key.shareToken]

        let preview = WagerPreview(
            id: id,
            title: title,
            sideA: sideA,
            sideB: sideB,
            endTime: endTime,
            status: status,
            winningSide: winningSide,
            paymentType: paymentType,
            stakeAmount: stakeAmount,
            totalBets: totalBets,
            totalParticipants: totalParticipants,
            sideACount: sideACount,
            sideBCount: sideBCount,
            sideATotal: sideATotal,
            sideBTotal: sideBTotal
        )

        return (preview, shareToken)
    }

    // MARK: - Bubble image rendering

    private static let brandBlue = UIColor(red: 0x25 / 255.0, green: 0x63 / 255.0, blue: 0xeb / 255.0, alpha: 1)
    private static let brandBlueDark = UIColor(red: 0x1e / 255.0, green: 0x40 / 255.0, blue: 0xa8 / 255.0, alpha: 1)
    private static let gold = UIColor(red: 0xf5 / 255.0, green: 0x9e / 255.0, blue: 0x0b / 255.0, alpha: 1)

    /// Renders a ~600x360pt bubble card with pure Core Graphics/UIKit text
    /// drawing — no asset dependencies. Returns nil (never traps) if
    /// anything about the target size is degenerate.
    private static func renderCardImage(for preview: WagerPreview) -> UIImage? {
        let size = CGSize(width: 600, height: 360)
        guard size.width > 0, size.height > 0 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { context in
            let rect = CGRect(origin: .zero, size: size)
            let cg = context.cgContext

            let backgroundPath = UIBezierPath(roundedRect: rect, cornerRadius: 28)
            cg.saveGState()
            backgroundPath.addClip()
            if let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: [brandBlue.cgColor, brandBlueDark.cgColor] as CFArray,
                locations: [0, 1]
            ) {
                cg.drawLinearGradient(
                    gradient,
                    start: CGPoint(x: 0, y: 0),
                    end: CGPoint(x: 0, y: size.height),
                    options: []
                )
            } else {
                brandBlue.setFill()
                backgroundPath.fill()
            }
            cg.restoreGState()

            let titleStyle = NSMutableParagraphStyle()
            titleStyle.lineBreakMode = .byTruncatingTail
            let titleRect = CGRect(x: 28, y: 26, width: size.width - 56, height: 84)
            (preview.title as NSString).draw(
                in: titleRect,
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: 32, weight: .bold),
                    .foregroundColor: UIColor.white,
                    .paragraphStyle: titleStyle,
                ]
            )

            let boxY: CGFloat = 118
            let boxHeight: CGFloat = 96
            let boxWidth = (size.width - 56 - 20) / 2

            drawSideBox(
                cg: cg, label: preview.sideA, count: preview.sideACount, total: preview.sideATotal,
                rect: CGRect(x: 28, y: boxY, width: boxWidth, height: boxHeight)
            )
            drawSideBox(
                cg: cg, label: preview.sideB, count: preview.sideBCount, total: preview.sideBTotal,
                rect: CGRect(x: 28 + boxWidth + 20, y: boxY, width: boxWidth, height: boxHeight)
            )

            var footerParts: [String] = []
            if let stakeText = preview.stakeText {
                footerParts.append(stakeText)
            }
            footerParts.append(preview.deadlineText)
            let footerText = footerParts.joined(separator: "   ·   ")
            (footerText as NSString).draw(
                at: CGPoint(x: 28, y: size.height - 46),
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: 17, weight: .medium),
                    .foregroundColor: UIColor.white.withAlphaComponent(0.92),
                ]
            )
        }
    }

    private static func drawSideBox(cg: CGContext, label: String, count: Int, total: Double?, rect: CGRect) {
        let path = UIBezierPath(roundedRect: rect, cornerRadius: 16)
        UIColor.white.withAlphaComponent(0.14).setFill()
        path.fill()

        let labelStyle = NSMutableParagraphStyle()
        labelStyle.lineBreakMode = .byTruncatingTail
        (label as NSString).draw(
            in: rect.insetBy(dx: 14, dy: 12),
            withAttributes: [
                .font: UIFont.systemFont(ofSize: 21, weight: .semibold),
                .foregroundColor: UIColor.white,
                .paragraphStyle: labelStyle,
            ]
        )

        var countText = "\(count) bet\(count == 1 ? "" : "s")"
        if let total = total, total > 0 {
            countText += " · $\(String(format: "%.0f", total))"
        }
        (countText as NSString).draw(
            at: CGPoint(x: rect.minX + 14, y: rect.maxY - 30),
            withAttributes: [
                .font: UIFont.systemFont(ofSize: 14, weight: .regular),
                .foregroundColor: gold,
            ]
        )
    }
}

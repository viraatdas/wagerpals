import Messages
import UIKit
import SwiftUI

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
        layout.subcaption = subcaption(for: preview)
        layout.trailingCaption = oddsText(for: preview)
        layout.trailingSubcaption = preview.deadlineText
        // Fallback text Messages shows if `layout.image` can't render for
        // any reason — keeps the "take a side" call to action legible even
        // in that degraded case.
        layout.imageTitle = preview.title
        layout.imageSubtitle = preview.isOpen ? "Tap to take a side" : preview.status.capitalized
        // If rendering fails for any reason, `layout.image` simply stays nil
        // rather than crashing the extension.
        if let image = renderCardImage(for: preview) {
            layout.image = image
        }
        return layout
    }

    private static func subcaption(for preview: WagerPreview) -> String {
        var text = "\(preview.sideA)  vs  \(preview.sideB)"
        if let stakeText = preview.stakeText {
            text += " · \(stakeText)"
        }
        return text
    }

    /// Mono percentage split, e.g. "62% · 38%" — the odds. Falls back to the
    /// bet-count split when nobody has staked anything yet, since a 50/50
    /// split there would misleadingly read as "even odds" rather than "no
    /// stakes yet".
    private static func oddsText(for preview: WagerPreview) -> String {
        let sideATotal = preview.sideATotal ?? 0
        let sideBTotal = preview.sideBTotal ?? 0
        let pool = sideATotal + sideBTotal
        guard pool > 0 else { return preview.splitText }
        let sideAPercent = Int((sideATotal / pool * 100).rounded())
        return "\(sideAPercent)% · \(100 - sideAPercent)%"
    }

    private static func summary(for preview: WagerPreview) -> String {
        "\(preview.title): \(oddsText(for: preview)) · \(preview.deadlineText)"
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
    //
    // Fixed light "paper" brand regardless of system appearance, matching
    // every other screen in this extension (see WagerTheme.swift's header
    // comment). `UIColor(Color.wagerX)` bridges the same SwiftUI tokens Core
    // Graphics needs here, so there's exactly one place these hexes live.

    private static let paper = UIColor(Color.wagerPaper)
    private static let cardInk = UIColor(Color.wagerInk)
    private static let cardInkSecondary = UIColor(Color.wagerInkSecondary)
    private static let cardLine = UIColor(Color.wagerLine)
    private static let cardEmerald = UIColor(Color.wagerEmerald)
    private static let cardCrimson = UIColor(Color.wagerCrimson)
    private static let cardCrimsonInk = UIColor(Color.wagerCrimsonInk)
    private static let cardGoldFill = UIColor(Color.wagerGoldFill)
    private static let cardOnEmerald = UIColor(Color.wagerOnEmerald)

    /// Renders a ~600x360pt bubble card with pure Core Graphics/UIKit text
    /// drawing — no asset dependencies, and no SwiftUI `ImageRenderer`
    /// (iOS 16+; this target's deployment floor is 15.1). Returns nil
    /// (never traps) if anything about the target size is degenerate.
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

            // Paper card, thin line border.
            let backgroundPath = UIBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), cornerRadius: 28)
            paper.setFill()
            backgroundPath.fill()
            cardLine.setStroke()
            backgroundPath.lineWidth = 2
            backgroundPath.stroke()

            drawWordmark(at: CGPoint(x: 28, y: 24))

            let titleStyle = NSMutableParagraphStyle()
            titleStyle.lineBreakMode = .byTruncatingTail
            let titleRect = CGRect(x: 28, y: 58, width: size.width - 56, height: 68)
            (preview.title as NSString).draw(
                in: titleRect,
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: 28, weight: .bold),
                    .foregroundColor: cardInk,
                    .paragraphStyle: titleStyle,
                ]
            )

            let boxY: CGFloat = 132
            let boxHeight: CGFloat = 92
            let boxWidth = (size.width - 56 - 20) / 2
            let isResolved = preview.winningSide != nil

            drawSideBox(
                label: preview.sideA, count: preview.sideACount, total: preview.sideATotal,
                paymentType: preview.paymentType, tint: cardEmerald,
                isWinner: isResolved && preview.winningSide == preview.sideA,
                rect: CGRect(x: 28, y: boxY, width: boxWidth, height: boxHeight)
            )
            drawSideBox(
                label: preview.sideB, count: preview.sideBCount, total: preview.sideBTotal,
                paymentType: preview.paymentType, tint: cardCrimsonInk,
                isWinner: isResolved && preview.winningSide == preview.sideB,
                rect: CGRect(x: 28 + boxWidth + 20, y: boxY, width: boxWidth, height: boxHeight)
            )

            // The confidence bar — the signature element, reproduced here in
            // Core Graphics since `MSMessageTemplateLayout.image` wants a
            // plain UIImage rather than a SwiftUI view.
            let barRect = CGRect(x: 28, y: boxY + boxHeight + 18, width: size.width - 56, height: 10)
            drawConfidenceBar(cg: cg, rect: barRect, sideATotal: preview.sideATotal, sideBTotal: preview.sideBTotal)

            var footerParts: [String] = []
            if let stakeText = preview.stakeText {
                footerParts.append(stakeText)
            }
            footerParts.append(preview.deadlineText)
            let footerText = footerParts.joined(separator: "   ·   ")
            (footerText as NSString).draw(
                at: CGPoint(x: 28, y: size.height - 44),
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: 16, weight: .medium),
                    .foregroundColor: cardInkSecondary,
                ]
            )

            if preview.isOpen {
                drawPill(
                    text: "Take a side",
                    trailingEdge: size.width - 28,
                    y: size.height - 54,
                    background: cardEmerald,
                    textColor: cardOnEmerald
                )
            } else if isResolved {
                drawPill(
                    text: "\(preview.winningSide ?? preview.sideA) won",
                    trailingEdge: size.width - 28,
                    y: size.height - 54,
                    background: cardGoldFill,
                    textColor: cardOnEmerald
                )
            }
        }
    }

    /// Bold ink "Wager" + emerald "Pals" in the top-left corner — same
    /// lockup as `WagerSignedOutView.wordmark`, drawn directly since this is
    /// Core Graphics, not SwiftUI.
    private static func drawWordmark(at origin: CGPoint) {
        let wagerAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 15, weight: .heavy),
            .foregroundColor: cardInk,
        ]
        let palsAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 15, weight: .heavy),
            .foregroundColor: cardEmerald,
        ]
        let wagerSize = ("Wager" as NSString).size(withAttributes: wagerAttrs)
        ("Wager" as NSString).draw(at: origin, withAttributes: wagerAttrs)
        ("Pals" as NSString).draw(
            at: CGPoint(x: origin.x + wagerSize.width, y: origin.y),
            withAttributes: palsAttrs
        )
    }

    private static func drawSideBox(
        label: String,
        count: Int,
        total: Double?,
        paymentType: WagerPaymentType,
        tint: UIColor,
        isWinner: Bool,
        rect: CGRect
    ) {
        let path = UIBezierPath(roundedRect: rect, cornerRadius: 16)
        (isWinner ? cardGoldFill.withAlphaComponent(0.18) : tint.withAlphaComponent(0.10)).setFill()
        path.fill()
        (isWinner ? cardGoldFill.withAlphaComponent(0.5) : tint.withAlphaComponent(0.3)).setStroke()
        path.lineWidth = 1
        path.stroke()

        let labelStyle = NSMutableParagraphStyle()
        labelStyle.lineBreakMode = .byTruncatingTail
        (label as NSString).draw(
            in: rect.insetBy(dx: 14, dy: 12),
            withAttributes: [
                .font: UIFont.systemFont(ofSize: 19, weight: .semibold),
                .foregroundColor: cardInk,
                .paragraphStyle: labelStyle,
            ]
        )

        // Numbers are always mono, in the side's own emerald/crimson tint —
        // never amber, which is reserved for people.
        var countText = "\(count) bet\(count == 1 ? "" : "s")"
        if let total = total, total > 0 {
            countText += " · \(WagerMoney.format(total, paymentType: paymentType))"
        }
        (countText as NSString).draw(
            at: CGPoint(x: rect.minX + 14, y: rect.maxY - 28),
            withAttributes: [
                .font: UIFont.monospacedSystemFont(ofSize: 13, weight: .medium),
                .foregroundColor: tint,
            ]
        )
    }

    /// Emerald fill from the left edge, crimson from the right, meeting at
    /// the split — same rule as `WagerConfidenceBar` (SwiftUI), reproduced
    /// in Core Graphics for the bubble image. An empty line-colored track
    /// when nobody has staked anything yet.
    private static func drawConfidenceBar(cg: CGContext, rect: CGRect, sideATotal: Double?, sideBTotal: Double?) {
        let trackPath = UIBezierPath(roundedRect: rect, cornerRadius: rect.height / 2)
        let sideATotalValue = sideATotal ?? 0
        let sideBTotalValue = sideBTotal ?? 0
        let pool = sideATotalValue + sideBTotalValue

        guard pool > 0 else {
            cardLine.setFill()
            trackPath.fill()
            return
        }

        cg.saveGState()
        trackPath.addClip()
        let splitX = rect.minX + rect.width * CGFloat(sideATotalValue / pool)
        cardEmerald.setFill()
        UIBezierPath(rect: CGRect(x: rect.minX, y: rect.minY, width: splitX - rect.minX, height: rect.height)).fill()
        cardCrimson.setFill()
        UIBezierPath(rect: CGRect(x: splitX, y: rect.minY, width: rect.maxX - splitX, height: rect.height)).fill()
        cg.restoreGState()
    }

    /// A small fully-rounded status pill — one of the shapes this extension
    /// reserves fully-rounded corners for (status pills), unlike its 8/10pt
    /// controls and cards.
    private static func drawPill(text: String, trailingEdge: CGFloat, y: CGFloat, background: UIColor, textColor: UIColor) {
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 15, weight: .semibold)]
        let textSize = (text as NSString).size(withAttributes: attrs)
        let horizontalPadding: CGFloat = 14
        let pillWidth = textSize.width + horizontalPadding * 2
        let pillHeight: CGFloat = 32
        let pillRect = CGRect(x: trailingEdge - pillWidth, y: y, width: pillWidth, height: pillHeight)
        let pillPath = UIBezierPath(roundedRect: pillRect, cornerRadius: pillHeight / 2)
        background.setFill()
        pillPath.fill()

        (text as NSString).draw(
            at: CGPoint(x: pillRect.minX + horizontalPadding, y: pillRect.minY + (pillHeight - textSize.height) / 2),
            withAttributes: [
                .font: UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: textColor,
            ]
        )
    }
}

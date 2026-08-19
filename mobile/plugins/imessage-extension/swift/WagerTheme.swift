import SwiftUI

// MARK: - Brand tokens
//
// Swift can't read the CSS custom properties in app/globals.css, so these are
// the same hexes reproduced as literals, one per canonical token, each named
// for its CSS var (see DESIGN-SPEC.md / mobile/src/theme.ts). This extension
// intentionally renders with the fixed light "paper" brand regardless of the
// system appearance — same call the signed-out view already made before this
// pass; this file just extends that language to every screen instead of only
// the empty state.
extension Color {
    static let wagerPaper = Color(red: 0xfa / 255.0, green: 0xf7 / 255.0, blue: 0xf0 / 255.0) // --color-paper
    static let wagerCard = Color.white // --color-surface
    static let wagerInk = Color(red: 0x1c / 255.0, green: 0x1b / 255.0, blue: 0x17 / 255.0) // --color-ink
    static let wagerInkSecondary = Color(red: 0x57 / 255.0, green: 0x54 / 255.0, blue: 0x48 / 255.0) // --color-ink-secondary
    static let wagerInkMuted = Color(red: 0x74 / 255.0, green: 0x70 / 255.0, blue: 0x60 / 255.0) // --color-ink-muted
    static let wagerLine = Color(red: 0xe7 / 255.0, green: 0xe2 / 255.0, blue: 0xd6 / 255.0) // --color-line
    static let wagerLineStrong = Color(red: 0x97 / 255.0, green: 0x8f / 255.0, blue: 0x74 / 255.0) // --color-line-strong
    static let wagerEmerald = Color(red: 0x0f / 255.0, green: 0x7a / 255.0, blue: 0x4c / 255.0) // --color-emerald
    static let wagerCrimson = Color(red: 0xd6 / 255.0, green: 0x45 / 255.0, blue: 0x45 / 255.0) // --color-crimson
    static let wagerCrimsonInk = Color(red: 0xd2 / 255.0, green: 0x33 / 255.0, blue: 0x33 / 255.0) // --color-crimson-ink
    static let wagerAmber = Color(red: 0xf2 / 255.0, green: 0xa9 / 255.0, blue: 0x3b / 255.0) // --color-amber
    static let wagerAmberInk = Color(red: 0x9d / 255.0, green: 0x63 / 255.0, blue: 0x0a / 255.0) // --color-amber-ink
    // Won-money gold — distinct from amber; amber never touches a money value.
    static let wagerGoldFill = Color(red: 0xd8 / 255.0, green: 0x76 / 255.0, blue: 0x06 / 255.0) // won-money fill
    static let wagerGoldInk = Color(red: 0x92 / 255.0, green: 0x40 / 255.0, blue: 0x0e / 255.0) // won-money ink
    static let wagerOnEmerald = Color.white
}

enum WagerRadius {
    /// --radius-control
    static let control: CGFloat = 8
    /// --radius-card
    static let card: CGFloat = 10
    /// --radius-panel
    static let panel: CGFloat = 12
}

extension Font {
    /// Every number (stakes, odds, percentages, counts) renders in a
    /// monospaced design so figures line up — the closest this target can
    /// get to the web/mobile app's IBM Plex Mono without bundling a font
    /// asset into a ~50MB-budget extension. Never used above `.semibold`,
    /// mirroring the "never render Plex Mono above weight 500" rule.
    static func wagerMono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    /// Screen titles / wordmark only — stands in for Archivo Black for the
    /// same reason (`WagerSignedOutView.wordmark` already does this).
    static func wagerDisplay(_ size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

// MARK: - Money formatting
//
// `payment_type == "cash"` bets escrow real USD; `payment_type == "none"`
// bets still escrow WagerPals' internal play currency ("W") — see
// lib/payments.ts's `formatCurrencyAmount` (`W${amount}` for currency 'wp').
// Earlier revisions of this extension hardcoded "$" even for W-mode amount
// fields; this is the single place that decision is made so it can't drift
// per-screen again.
enum WagerMoney {
    static func symbol(for paymentType: WagerPaymentType) -> String {
        paymentType == .cash ? "$" : "W"
    }

    private static func formattedNumber(_ amount: Double) -> String {
        amount.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", amount)
            : String(format: "%.2f", amount)
    }

    /// e.g. "$12" / "$12.50" / "W12" / "W12.50"
    static func format(_ amount: Double, paymentType: WagerPaymentType) -> String {
        "\(symbol(for: paymentType))\(formattedNumber(amount))"
    }
}

// MARK: - The confidence bar
//
// THE signature element (see DESIGN-SPEC.md): emerald fill from the left
// edge, crimson from the right, meeting at the split, optional percent
// labels in mono at each end, an empty track + "No stakes yet" when the pool
// is 0. Fill animates in once on first mount (~400ms ease-out), respecting
// the OS reduce-motion setting — nothing else about this view animates.
struct WagerConfidenceBar: View {
    /// Fraction of the pool riding on side A, 0...1. Side B gets the rest.
    let sideAFraction: Double
    let hasStakes: Bool
    var height: CGFloat = 6
    var showsLabels: Bool = true

    @State private var animatedFraction: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var clamped: Double { min(max(sideAFraction, 0), 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if showsLabels {
                HStack {
                    Text(hasStakes ? "\(Int((clamped * 100).rounded()))%" : "—")
                        .font(.wagerMono(11))
                        .foregroundColor(.wagerEmerald)
                    Spacer()
                    Text(hasStakes ? "\(Int(((1 - clamped) * 100).rounded()))%" : "—")
                        .font(.wagerMono(11))
                        .foregroundColor(.wagerCrimsonInk)
                }
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: height / 2)
                        .fill(Color.wagerLine)
                    if hasStakes {
                        HStack(spacing: 0) {
                            Rectangle()
                                .fill(Color.wagerEmerald)
                                .frame(width: geometry.size.width * animatedFraction)
                            Rectangle()
                                .fill(Color.wagerCrimson)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: height / 2))
                    }
                }
            }
            .frame(height: height)

            if !hasStakes {
                Text("No stakes yet")
                    .font(.caption2)
                    .foregroundColor(.wagerInkMuted)
            }
        }
        .onAppear { animateIn() }
        .onChange(of: clamped) { _ in animateIn() }
    }

    private func animateIn() {
        guard !reduceMotion else {
            animatedFraction = clamped
            return
        }
        animatedFraction = 0
        withAnimation(.easeOut(duration: 0.4)) {
            animatedFraction = clamped
        }
    }
}

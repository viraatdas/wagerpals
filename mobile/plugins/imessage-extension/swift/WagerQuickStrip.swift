import SwiftUI

/// The compact-mode "quick strip": a horizontal row of the user's groups'
/// LIVE wagers as small tappable cards, led by a "New wager" tile. Tapping a
/// card inserts that wager into the conversation as a rich message (see
/// `MessagesViewController.insertExistingWager`); tapping the leading tile
/// expands to the full compose sheet. This is what `CompactWagerView` shows
/// when the user isn't looking at an already-selected wager bubble.
struct WagerQuickStripView: View {
    @ObservedObject var state: WagerExtensionState
    var onInsert: (WagerPreview) -> Void
    var onNewWager: () -> Void

    private var liveWagers: [WagerEventSummary] {
        // A display cap, not a load cap — `loadLiveEvents` already bounds how
        // many groups it fans out to. Keeping the row short matters inside a
        // memory-constrained (~50MB) extension.
        Array(state.liveEvents.prefix(12))
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                WagerNewWagerTile(action: onNewWager)

                if liveWagers.isEmpty {
                    WagerEmptySlipCard()
                } else {
                    ForEach(liveWagers) { event in
                        WagerLiveWagerCard(event: event, groupName: groupName(for: event.groupId)) {
                            onInsert(event.preview)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        // A horizontal ScrollView only sizes to its content's height unless
        // told otherwise — fill the compact sheet first, then paint, so any
        // extra vertical space below the cards is paper, not the hosting
        // view showing through.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.wagerPaper)
    }

    private func groupName(for groupId: String) -> String {
        state.groups.first(where: { $0.id == groupId })?.name ?? ""
    }
}

/// Leading tile of the quick strip — a dashed emerald outline (echoes the
/// blank-betting-slip empty-state idiom rather than a plain "+" button).
private struct WagerNewWagerTile: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.wagerEmerald)
                Text("New wager")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.wagerInk)
                    .lineLimit(1)
            }
            .frame(width: 92, height: 84)
            .background(Color.wagerCard)
            .overlay(
                RoundedRectangle(cornerRadius: WagerRadius.card)
                    .stroke(Color.wagerEmerald.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
            )
            .cornerRadius(WagerRadius.card)
        }
        .buttonStyle(.plain)
    }
}

/// The blank-betting-slip empty state, shown in the strip when no group has
/// a live wager: dashed border, ghosted "— : —" in mono at reduced opacity,
/// product-voice copy (no icon-in-a-circle).
private struct WagerEmptySlipCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("— : —")
                .font(.wagerMono(15))
                .foregroundColor(Color.wagerInk.opacity(0.4))
            Text("No live wagers yet.")
                .font(.caption2)
                .foregroundColor(.wagerInkMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 150, height: 84, alignment: .topLeading)
        .padding(10)
        .background(Color.wagerCard)
        .overlay(
            RoundedRectangle(cornerRadius: WagerRadius.card)
                .stroke(Color.wagerLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
        .cornerRadius(WagerRadius.card)
    }
}

/// One live wager card: title, mono odds, a mini confidence bar, and the
/// pool's W/$ amount — tapping it inserts the wager into the conversation.
private struct WagerLiveWagerCard: View {
    let event: WagerEventSummary
    let groupName: String
    let action: () -> Void

    private var sideAStat: WagerSideStat { event.sideStats[event.sideA] ?? WagerSideStat(count: 0, total: 0) }
    private var sideBStat: WagerSideStat { event.sideStats[event.sideB] ?? WagerSideStat(count: 0, total: 0) }
    private var pool: Double { sideAStat.total + sideBStat.total }
    private var hasStakes: Bool { pool > 0 }
    private var sideAFraction: Double { hasStakes ? sideAStat.total / pool : 0.5 }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                if !groupName.isEmpty {
                    // Group name is a "people" label, not a money value —
                    // amber, per the color rule.
                    Text(groupName.uppercased())
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.wagerAmberInk)
                        .lineLimit(1)
                }

                Text(event.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.wagerInk)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                WagerConfidenceBar(sideAFraction: sideAFraction, hasStakes: hasStakes, height: 4, showsLabels: false)

                HStack {
                    Text(hasStakes ? WagerMoney.format(pool, paymentType: event.paymentType) : "No stakes")
                        .font(.wagerMono(10))
                        .foregroundColor(.wagerInkSecondary)
                    Spacer()
                    Text("\(event.totalBets)")
                        .font(.wagerMono(10))
                        .foregroundColor(.wagerInkMuted)
                }
            }
            .padding(10)
            .frame(width: 150, height: 84, alignment: .topLeading)
            .background(Color.wagerCard)
            .overlay(
                RoundedRectangle(cornerRadius: WagerRadius.card)
                    .stroke(Color.wagerLine, lineWidth: 1)
            )
            .cornerRadius(WagerRadius.card)
        }
        .buttonStyle(.plain)
    }
}

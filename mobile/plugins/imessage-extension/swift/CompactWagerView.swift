import SwiftUI

// MARK: - Shared, module-wide pieces
//
// Used by CompactWagerView, ComposeWagerView and TakeSideView. Kept here
// since CompactWagerView is the simplest/first screen a user sees. Brand
// color/font tokens live in WagerTheme.swift now — every screen in this
// extension draws from that one token set.

enum WagerConstants {
    /// Mirrors `MAX_TRANSACTION_AMOUNT` enforced server-side (see lib/payments.ts).
    static let maxStake: Double = 500
}

/// Which side of a wager the user has picked in a form, if any.
enum PickedSide: Equatable {
    case none
    case a
    case b
}

/// Quick deadline choices offered in both the compact strip and the
/// expanded compose form.
enum QuickDeadline: String, CaseIterable, Identifiable, Equatable {
    case oneHour = "1h"
    case today = "Today"
    case threeDays = "3 days"
    case oneWeek = "1 week"

    var id: String { rawValue }

    /// Milliseconds-since-epoch deadline for this choice, computed from `now`.
    func endTimeMs(from now: Date = Date()) -> Double {
        let seconds: TimeInterval
        switch self {
        case .oneHour:
            seconds = 3600
        case .today:
            let calendar = Calendar.current
            let startOfToday = calendar.startOfDay(for: now)
            let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? now.addingTimeInterval(86400)
            let endOfToday = startOfTomorrow.addingTimeInterval(-1)
            // Guard the edge case of "today" already having elapsed (shouldn't
            // normally happen since this is always evaluated against `now`).
            let effective = endOfToday > now ? endOfToday : now.addingTimeInterval(3600)
            return effective.timeIntervalSince1970 * 1000
        case .threeDays:
            seconds = 3 * 86400
        case .oneWeek:
            seconds = 7 * 86400
        }
        return now.addingTimeInterval(seconds).timeIntervalSince1970 * 1000
    }
}

/// Shared, observable draft for the "create a new wager" flow. One instance
/// is owned by `MessagesViewController` and handed to both `CompactWagerView`
/// and `ComposeWagerView` so text typed in the compact strip survives the
/// transition to the expanded compose form (and vice versa).
@MainActor
final class WagerComposerDraft: ObservableObject {
    @Published var title: String = ""
    @Published var sideA: String = ""
    @Published var sideB: String = ""
    @Published var groupId: String?
    @Published var quickDeadline: QuickDeadline = .today
    @Published var paymentType: WagerPaymentType = .none
    @Published var stakeText: String = ""
    @Published var notifySubject: Bool = true
    @Published var takeSideNow: Bool = false
    @Published var pickedSide: PickedSide = .none
    @Published var amountText: String = ""

    /// Only used to render the (always-empty) "tag someone" picker — see the
    /// note in ComposeWagerView about why this can never hold a real id.
    @Published var subjectUserId: String? = nil

    func seedDefaultGroupIfNeeded(groups: [WagerGroup]) {
        guard groupId == nil || !groups.contains(where: { $0.id == groupId }) else { return }
        if let last = WagerLocalCache.lastGroupId, groups.contains(where: { $0.id == last }) {
            groupId = last
        } else {
            groupId = groups.first?.id
        }
    }
}

/// Result of validating a `WagerComposerDraft`. Not `Swift.Result` because
/// the failure case is a plain human-readable message, not an `Error`.
enum WagerDraftValidationResult {
    case success(WagerCreateRequest)
    case failure(String)
}

/// Validates a `WagerComposerDraft` and turns it into a `WagerCreateRequest`,
/// or returns a human-readable reason it can't be sent yet. Shared by the
/// compact fast-path and the full expanded form so validation stays in sync.
@MainActor
enum WagerDraftValidation {
    static func makeRequest(from draft: WagerComposerDraft) -> WagerDraftValidationResult {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let sideA = draft.sideA.trimmingCharacters(in: .whitespacesAndNewlines)
        let sideB = draft.sideB.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !title.isEmpty else { return .failure("Give the wager a title.") }
        guard !sideA.isEmpty, !sideB.isEmpty else { return .failure("Both sides need a name.") }
        guard sideA.caseInsensitiveCompare(sideB) != .orderedSame else {
            return .failure("The two sides must be different.")
        }
        guard let groupId = draft.groupId, !groupId.isEmpty else { return .failure("Pick a group.") }

        let endTime = draft.quickDeadline.endTimeMs()
        guard endTime > Date().timeIntervalSince1970 * 1000 else {
            return .failure("Deadline must be in the future.")
        }

        var stakeAmount: Double?
        if draft.paymentType == .cash {
            let trimmedStake = draft.stakeText.trimmingCharacters(in: .whitespaces)
            if !trimmedStake.isEmpty {
                guard let value = Double(trimmedStake), value > 0 else {
                    return .failure("Enter a valid stake amount.")
                }
                guard value <= WagerConstants.maxStake else {
                    return .failure("Maximum stake is $\(Int(WagerConstants.maxStake)).")
                }
                stakeAmount = (value * 100).rounded() / 100
            }
        }

        var side: String?
        var amount: Double?
        if draft.takeSideNow {
            switch draft.pickedSide {
            case .a: side = sideA
            case .b: side = sideB
            case .none: side = nil
            }
            let trimmedAmount = draft.amountText.trimmingCharacters(in: .whitespaces)
            if side != nil, !trimmedAmount.isEmpty, let value = Double(trimmedAmount), value > 0 {
                amount = value
            }
        }

        let request = WagerCreateRequest(
            groupId: groupId,
            title: title,
            sideA: sideA,
            sideB: sideB,
            endTime: endTime,
            paymentType: draft.paymentType,
            stakeAmount: stakeAmount,
            subjectUserId: nil,
            notifySubject: draft.notifySubject,
            side: side,
            amount: amount
        )
        return .success(request)
    }
}

/// A small "Group" menu button reused by the compact and expanded compose
/// forms.
struct WagerGroupPicker: View {
    let groups: [WagerGroup]
    @Binding var selection: String?
    var compact: Bool = false

    private var selectedName: String {
        groups.first(where: { $0.id == selection })?.name ?? "Choose group"
    }

    var body: some View {
        Menu {
            ForEach(groups) { group in
                Button {
                    selection = group.id
                } label: {
                    if group.id == selection {
                        Label(group.name, systemImage: "checkmark")
                    } else {
                        Text(group.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(selectedName)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            // Group names are a "people" label, not a money value — amber,
            // per the color rule (see WagerTheme.swift).
            .font(compact ? .caption : .subheadline)
            .foregroundColor(.wagerAmberInk)
            .padding(.horizontal, compact ? 8 : 12)
            .padding(.vertical, compact ? 5 : 8)
            .background(Color.wagerAmber.opacity(0.15))
            .cornerRadius(WagerRadius.control)
        }
        .disabled(groups.isEmpty)
    }
}

/// Short explainer shown whenever the user isn't signed in to WagerPals.
/// Paper canvas, ink/emerald wordmark, one warm line of product voice, crisp
/// 8pt-radius emerald button. When `preview` is set (the user opened this
/// extension on a message that decodes to a wager, but isn't signed in yet)
/// it also renders a read-only snapshot of that wager — title and odds only,
/// no interaction — above the sign-in prompt, so a signed-out recipient can
/// still see what the bubble is about. Sign-in detection, the API layer and
/// what happens when the button is tapped (`onOpenApp`) are unchanged; see
/// MessagesViewController.swift for the actual signed-out/signed-in check.
struct WagerSignedOutView: View {
    var onOpenApp: () -> Void
    var compact: Bool = false
    var preview: WagerPreview? = nil

    var body: some View {
        if compact {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    wordmark(size: 13)
                    if let preview = preview {
                        Text("\(preview.title) — sign in to take a side.")
                            .font(.caption2)
                            .foregroundColor(.wagerInkSecondary)
                            .lineLimit(1)
                    } else {
                        Text("Sign in to start a wager.")
                            .font(.caption2)
                            .foregroundColor(.wagerInkSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Button("Open App", action: onOpenApp)
                    .buttonStyle(WagerPrimaryButtonStyle(compact: true))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.wagerPaper)
        } else {
            VStack(spacing: 18) {
                wordmark(size: 30)

                if let preview = preview {
                    WagerReadOnlyPreviewCard(preview: preview)
                        .padding(.horizontal, 20)
                }

                Text(preview != nil
                     ? "Sign in to WagerPals to take a side."
                     : "Sign in to WagerPals to start a wager.")
                    .font(.subheadline)
                    .foregroundColor(.wagerInkSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                Button("Open WagerPals to sign in", action: onOpenApp)
                    .buttonStyle(WagerPrimaryButtonStyle(compact: false))
            }
            .padding(.top, 36)
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
            .background(Color.wagerPaper)
        }
    }

    /// Bold ink "Wager" + emerald "Pals" — the same lockup treatment as the
    /// web/mobile wordmark (Logo.tsx / theme.ts), reproduced with a heavy
    /// system font since the extension target doesn't bundle the Archivo
    /// Black asset the main app loads via @expo-google-fonts.
    private func wordmark(size: CGFloat) -> some View {
        HStack(spacing: 0) {
            Text("Wager")
                .font(.system(size: size, weight: .heavy, design: .rounded))
                .foregroundColor(.wagerInk)
            Text("Pals")
                .font(.system(size: size, weight: .heavy, design: .rounded))
                .foregroundColor(.wagerEmerald)
        }
    }
}

/// A read-only snapshot of a received wager — title, sides, and the
/// confidence bar, nothing tappable — shown in the signed-out view so
/// someone without an account yet can still see what the bubble is about.
private struct WagerReadOnlyPreviewCard: View {
    let preview: WagerPreview

    private var hasStakes: Bool { ((preview.sideATotal ?? 0) + (preview.sideBTotal ?? 0)) > 0 }
    private var sideAFraction: Double {
        let a = preview.sideATotal ?? 0
        let b = preview.sideBTotal ?? 0
        let pool = a + b
        return pool > 0 ? a / pool : 0.5
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(preview.title)
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.wagerInk)
                .lineLimit(2)
            Text("\(preview.sideA) vs \(preview.sideB)")
                .font(.caption)
                .foregroundColor(.wagerInkSecondary)
            WagerConfidenceBar(sideAFraction: sideAFraction, hasStakes: hasStakes)
        }
        .padding(14)
        .background(Color.wagerCard)
        .overlay(
            RoundedRectangle(cornerRadius: WagerRadius.card)
                .stroke(Color.wagerLine, lineWidth: 1)
        )
        .cornerRadius(WagerRadius.card)
    }
}

/// Crisp 8pt-radius emerald fill button — the signed-out view's primary call
/// to action, and reused wherever else the compact strip needs a small
/// emerald button. Deliberately not `.buttonStyle(.borderedProminent)`,
/// which renders as a rounded/capsule control on iOS; DESIGN-SPEC.md calls
/// for structured 8px-radius controls, pill shapes reserved for
/// avatars/chips/status pills.
struct WagerPrimaryButtonStyle: ButtonStyle {
    var compact: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font((compact ? Font.caption : Font.subheadline).weight(.semibold))
            .foregroundColor(.wagerOnEmerald)
            .padding(.horizontal, compact ? 14 : 20)
            .padding(.vertical, compact ? 7 : 12)
            .background(Color.wagerEmerald.opacity(configuration.isPressed ? 0.85 : 1))
            .cornerRadius(WagerRadius.control)
    }
}

/// A dismissible inline error banner — this extension never uses
/// `UIAlertController`.
struct WagerErrorBanner: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.caption)
            .foregroundColor(.wagerOnEmerald)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.wagerCrimson.opacity(0.92))
            .cornerRadius(WagerRadius.control)
    }
}

// MARK: - CompactWagerView

/// The compact presentation: a short strip above the keyboard. Renders one
/// of three states depending on sign-in status and whether the currently
/// selected message decodes to a wager:
///   - Signed out: `WagerSignedOutView` (with a read-only preview of the
///     selected wager, if any).
///   - A wager bubble is selected: a condensed live card for that wager,
///     with "Take a side" expanding into `TakeSideView`.
///   - Otherwise: the quick strip — the user's groups' live wagers as small
///     cards, led by a "New wager" tile that expands into `ComposeWagerView`.
struct CompactWagerView: View {
    @ObservedObject var state: WagerExtensionState
    @ObservedObject var draft: WagerComposerDraft
    let decoded: (preview: WagerPreview, shareToken: String?)?

    var onRequestExpand: () -> Void
    var onOpenApp: () -> Void
    /// Inserts an already-existing wager (tapped from the quick strip) into
    /// the conversation as a fresh bubble.
    var onInsertExisting: (WagerPreview) -> Void

    var body: some View {
        Group {
            if state.signInStatus == .signedOut {
                WagerSignedOutView(onOpenApp: onOpenApp, compact: true, preview: decoded?.preview)
            } else if let decoded = decoded {
                existingWagerStrip(decoded.preview)
            } else {
                WagerQuickStripView(state: state, onInsert: onInsertExisting, onNewWager: onRequestExpand)
            }
        }
        .background(Color.wagerPaper)
        .onAppear { draft.seedDefaultGroupIfNeeded(groups: state.groups) }
        .onChange(of: state.groups) { groups in draft.seedDefaultGroupIfNeeded(groups: groups) }
    }

    // MARK: Existing wager (condensed live card)

    private func existingWagerStrip(_ preview: WagerPreview) -> some View {
        let pool = (preview.sideATotal ?? 0) + (preview.sideBTotal ?? 0)
        let hasStakes = pool > 0
        let sideAFraction = hasStakes ? (preview.sideATotal ?? 0) / pool : 0.5

        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(preview.title)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.wagerInk)
                    .lineLimit(1)
                WagerConfidenceBar(sideAFraction: sideAFraction, hasStakes: hasStakes, height: 4, showsLabels: false)
                    .frame(width: 130)
                Text(preview.isOpen ? preview.deadlineText : preview.status.capitalized)
                    .font(.caption2)
                    .foregroundColor(preview.isOpen ? .wagerInkMuted : .wagerGoldInk)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Take a side", action: onRequestExpand)
                .buttonStyle(WagerPrimaryButtonStyle(compact: true))
                .disabled(!preview.isOpen)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

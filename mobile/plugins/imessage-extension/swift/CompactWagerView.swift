import SwiftUI

// MARK: - Shared brand styling
//
// Small, module-wide pieces used by CompactWagerView, ComposeWagerView and
// TakeSideView. Kept here since CompactWagerView is the simplest/first
// screen a user sees.

extension Color {
    static let wagerBrand = Color(red: 0x25 / 255.0, green: 0x63 / 255.0, blue: 0xeb / 255.0)
    static let wagerGold = Color(red: 0xf5 / 255.0, green: 0x9e / 255.0, blue: 0x0b / 255.0)

    // ---- Current WagerPals design-system tokens (see DESIGN-SPEC.md /
    // mobile/src/theme.ts) — Swift can't read the CSS custom properties in
    // app/globals.css, so these are the same hexes reproduced as literals,
    // one per canonical token, each named for its CSS var. Scoped to the
    // signed-out empty state (`WagerSignedOutView` below) for now — the rest
    // of this extension still renders with `wagerBrand`/`wagerGold` above.
    static let wagerPaper = Color(red: 0xfa / 255.0, green: 0xf7 / 255.0, blue: 0xf0 / 255.0) // --color-paper
    static let wagerInk = Color(red: 0x1c / 255.0, green: 0x1b / 255.0, blue: 0x17 / 255.0) // --color-ink
    static let wagerInkSecondary = Color(red: 0x57 / 255.0, green: 0x54 / 255.0, blue: 0x48 / 255.0) // --color-ink-secondary
    static let wagerEmerald = Color(red: 0x0f / 255.0, green: 0x7a / 255.0, blue: 0x4c / 255.0) // --color-emerald
    static let wagerLine = Color(red: 0xe7 / 255.0, green: 0xe2 / 255.0, blue: 0xd6 / 255.0) // --color-line
}

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
            .font(compact ? .caption : .subheadline)
            .foregroundColor(.wagerBrand)
            .padding(.horizontal, compact ? 8 : 12)
            .padding(.vertical, compact ? 5 : 8)
            .background(Color.wagerBrand.opacity(0.12))
            .cornerRadius(compact ? 8 : 10)
        }
        .disabled(groups.isEmpty)
    }
}

/// Short explainer shown whenever the user isn't signed in to WagerPals.
/// Restyled to the current brand (paper canvas, ink/emerald wordmark, one
/// warm line of product voice, crisp 8pt-radius emerald button) — this only
/// changes presentation. Sign-in detection, the API layer and what happens
/// when the button is tapped (`onOpenApp`) are unchanged; see
/// MessagesViewController.swift for the actual signed-out/signed-in check.
struct WagerSignedOutView: View {
    var onOpenApp: () -> Void
    var compact: Bool = false

    var body: some View {
        if compact {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    wordmark(size: 13)
                    Text("Sign in to start a wager.")
                        .font(.caption2)
                        .foregroundColor(.wagerInkSecondary)
                        .lineLimit(1)
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

                bettingSlipMotif

                Text("Sign in to WagerPals to start a wager.")
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

    /// A nod to the web/mobile "blank betting slip" empty-state idiom
    /// (dashed border, ghosted "— : —" placeholder) — the wager that's
    /// waiting on a signed-in user to fill it in.
    private var bettingSlipMotif: some View {
        HStack(spacing: 10) {
            Text("—")
            Spacer(minLength: 12)
            Text(":").opacity(0.6)
            Spacer(minLength: 12)
            Text("—")
        }
        .font(.system(.body, design: .monospaced))
        .foregroundColor(.wagerInk.opacity(0.4))
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(maxWidth: 220)
        .overlay(
            RoundedRectangle(cornerRadius: 10) // --radius-card
                .strokeBorder(Color.wagerLine, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        )
    }
}

/// Crisp 8pt-radius emerald fill button — the signed-out view's only call to
/// action. Deliberately not `.buttonStyle(.borderedProminent)`, which renders
/// as a rounded/capsule control on iOS; DESIGN-SPEC.md calls for structured
/// 8px-radius controls, pill shapes reserved for avatars/chips/status pills.
private struct WagerPrimaryButtonStyle: ButtonStyle {
    var compact: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font((compact ? Font.caption : Font.subheadline).weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, compact ? 14 : 20)
            .padding(.vertical, compact ? 7 : 12)
            .background(Color.wagerEmerald.opacity(configuration.isPressed ? 0.85 : 1))
            .cornerRadius(8) // --radius-control
    }
}

/// A dismissible inline error banner — this extension never uses
/// `UIAlertController`.
struct WagerErrorBanner: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.caption)
            .foregroundColor(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.85))
            .cornerRadius(8)
    }
}

// MARK: - CompactWagerView

/// The compact presentation: a short strip above the keyboard. Renders one
/// of three states depending on sign-in status and whether the currently
/// selected message decodes to a wager.
struct CompactWagerView: View {
    @ObservedObject var state: WagerExtensionState
    @ObservedObject var draft: WagerComposerDraft
    let decoded: (preview: WagerPreview, shareToken: String?)?

    var onSend: (WagerCreateRequest) -> Void
    var onRequestExpand: () -> Void
    var onOpenApp: () -> Void

    @State private var validationError: String?

    var body: some View {
        Group {
            if state.signInStatus == .signedOut {
                WagerSignedOutView(onOpenApp: onOpenApp, compact: true)
            } else if let decoded = decoded {
                existingWagerStrip(decoded.preview)
            } else {
                createStrip
            }
        }
        .background(Color(.systemBackground))
        .onAppear { draft.seedDefaultGroupIfNeeded(groups: state.groups) }
        .onChange(of: state.groups) { groups in draft.seedDefaultGroupIfNeeded(groups: groups) }
        .onChange(of: draft.stakeText) { text in
            draft.paymentType = text.trimmingCharacters(in: .whitespaces).isEmpty ? .none : .cash
        }
    }

    // MARK: Existing wager (condensed live card)

    private func existingWagerStrip(_ preview: WagerPreview) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(preview.title)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Text("\(preview.sideA) (\(preview.sideACount))  vs  \(preview.sideB) (\(preview.sideBCount))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text(preview.isOpen ? preview.deadlineText : preview.status.capitalized)
                    .font(.caption2)
                    .foregroundColor(.wagerGold)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Take a side", action: onRequestExpand)
                .buttonStyle(.borderedProminent)
                .tint(.wagerBrand)
                .controlSize(.small)
                .disabled(!preview.isOpen)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: Fast create path

    private var createStrip: some View {
        VStack(spacing: 5) {
            HStack(spacing: 6) {
                TextField("Wager title", text: $draft.title)
                    .font(.caption)
                    .textFieldStyle(.roundedBorder)
                WagerGroupPicker(groups: state.groups, selection: $draft.groupId, compact: true)
            }

            HStack(spacing: 6) {
                TextField("Side A", text: $draft.sideA)
                    .font(.caption)
                    .textFieldStyle(.roundedBorder)
                Text("vs")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                TextField("Side B", text: $draft.sideB)
                    .font(.caption)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 6) {
                Picker("", selection: $draft.quickDeadline) {
                    ForEach(QuickDeadline.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                HStack(spacing: 2) {
                    Text("$").font(.caption2).foregroundColor(.secondary)
                    TextField("Stake", text: $draft.stakeText)
                        .font(.caption)
                        .keyboardType(.decimalPad)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(Color(.systemGray6))
                .cornerRadius(6)
                .frame(width: 66)

                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                        .font(.caption)
                }
                .buttonStyle(.borderedProminent)
                .tint(.wagerBrand)
                .controlSize(.small)
                .disabled(state.isSending)

                Button("More", action: onRequestExpand)
                    .font(.caption2)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }

            if let validationError = validationError {
                Text(validationError)
                    .font(.caption2)
                    .foregroundColor(.red)
                    .lineLimit(1)
            } else if let errorMessage = state.errorMessage {
                Text(errorMessage)
                    .font(.caption2)
                    .foregroundColor(.red)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private func send() {
        switch WagerDraftValidation.makeRequest(from: draft) {
        case .success(let request):
            validationError = nil
            onSend(request)
        case .failure(let message):
            validationError = message
        }
    }
}

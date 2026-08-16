import SwiftUI

// MARK: - Shared brand styling
//
// Small, module-wide pieces used by CompactWagerView, ComposeWagerView and
// TakeSideView. Kept here since CompactWagerView is the simplest/first
// screen a user sees.

extension Color {
    static let wagerBrand = Color(red: 0x25 / 255.0, green: 0x63 / 255.0, blue: 0xeb / 255.0)
    static let wagerGold = Color(red: 0xf5 / 255.0, green: 0x9e / 255.0, blue: 0x0b / 255.0)
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
struct WagerSignedOutView: View {
    var onOpenApp: () -> Void
    var compact: Bool = false

    var body: some View {
        if compact {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Sign in to WagerPals")
                        .font(.caption)
                        .fontWeight(.semibold)
                    Text("to create or join wagers")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer(minLength: 8)
                Button("Open App", action: onOpenApp)
                    .buttonStyle(.borderedProminent)
                    .tint(.wagerBrand)
                    .controlSize(.small)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        } else {
            VStack(spacing: 16) {
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.system(size: 44))
                    .foregroundColor(.wagerBrand)
                Text("Sign in to WagerPals")
                    .font(.title3)
                    .fontWeight(.bold)
                Text("Open the WagerPals app to sign in, then come back to create or join wagers right from Messages.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("Open WagerPals to sign in", action: onOpenApp)
                    .buttonStyle(.borderedProminent)
                    .tint(.wagerBrand)
                    .controlSize(.large)
            }
            .padding(.top, 32)
            .padding(.horizontal, 20)
        }
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

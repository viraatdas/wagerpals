import SwiftUI

/// Shown expanded when the user taps an existing wager bubble. Refreshes the
/// live `WagerPreview` over the network, falls back to the snapshot decoded
/// from the message bubble if that fails, and lets the user take a side.
struct TakeSideView: View {
    @ObservedObject var state: WagerExtensionState
    let shareToken: String?
    var onUpdated: (WagerPreview) -> Void
    var onOpenInApp: () -> Void

    @State private var preview: WagerPreview
    @State private var isRefreshing = true
    @State private var refreshError: String?

    @State private var pickedSide: PickedSide = .none
    @State private var amountText: String = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var needsSignIn = false

    init(
        state: WagerExtensionState,
        initialPreview: WagerPreview,
        shareToken: String?,
        onUpdated: @escaping (WagerPreview) -> Void,
        onOpenInApp: @escaping () -> Void
    ) {
        self.state = state
        self._preview = State(initialValue: initialPreview)
        self.shareToken = shareToken
        self.onUpdated = onUpdated
        self.onOpenInApp = onOpenInApp
        if let stake = initialPreview.stakeAmount {
            self._amountText = State(initialValue: Self.formatAmount(stake))
        }
    }

    var body: some View {
        Group {
            if state.signInStatus == .signedOut {
                // A recipient who hasn't signed in yet still gets to see
                // what the bubble is about — just not to act on it.
                WagerSignedOutView(onOpenApp: onOpenInApp, compact: false, preview: preview)
            } else {
                signedInBody
            }
        }
        .task { await refreshPreview() }
    }

    private var signedInBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if let refreshError = refreshError {
                    VStack(alignment: .leading, spacing: 4) {
                        WagerErrorBanner(message: "Showing the last known state: \(refreshError)")
                    }
                }

                if preview.isOpen {
                    openSection
                } else {
                    closedSection
                }

                if let submitError = submitError {
                    WagerErrorBanner(message: submitError)
                }

                if needsSignIn {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Sign in to WagerPals to take a side.")
                            .font(.subheadline)
                            .foregroundColor(.wagerInk)
                        Button("Open WagerPals to sign in", action: onOpenInApp)
                            .buttonStyle(WagerPrimaryButtonStyle())
                    }
                }

                Spacer(minLength: 12)
            }
            .padding(20)
        }
        .background(Color.wagerPaper)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(preview.title)
                    .font(.wagerDisplay(20))
                    .foregroundColor(.wagerInk)
                Spacer()
                if isRefreshing {
                    ProgressView()
                }
            }

            HStack(spacing: 12) {
                sideBox(name: preview.sideA, count: preview.sideACount, total: preview.sideATotal, tint: .wagerEmerald, isWinner: preview.winningSide == preview.sideA)
                sideBox(name: preview.sideB, count: preview.sideBCount, total: preview.sideBTotal, tint: .wagerCrimsonInk, isWinner: preview.winningSide == preview.sideB)
            }

            WagerConfidenceBar(sideAFraction: confidenceFraction, hasStakes: hasStakes)

            HStack(spacing: 12) {
                Label(preview.isOpen ? preview.deadlineText : preview.status.capitalized, systemImage: "clock")
                if let stakeText = preview.stakeText {
                    Label(stakeText, systemImage: "dollarsign.circle")
                }
                Label("\(preview.totalBets) bets · \(preview.totalParticipants) people", systemImage: "person.2")
            }
            .font(.caption)
            .foregroundColor(.wagerInkSecondary)
        }
    }

    private var hasStakes: Bool { ((preview.sideATotal ?? 0) + (preview.sideBTotal ?? 0)) > 0 }

    private var confidenceFraction: Double {
        let a = preview.sideATotal ?? 0
        let b = preview.sideBTotal ?? 0
        let pool = a + b
        return pool > 0 ? a / pool : 0.5
    }

    private func sideBox(name: String, count: Int, total: Double?, tint: Color, isWinner: Bool) -> some View {
        var countText = "\(count) bet\(count == 1 ? "" : "s")"
        if let total = total, total > 0 {
            countText += " · \(WagerMoney.format(total, paymentType: preview.paymentType))"
        }

        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.wagerInk)
                    .lineLimit(1)
                if isWinner {
                    Image(systemName: "crown.fill")
                        .font(.caption2)
                        .foregroundColor(.wagerGoldInk)
                }
            }
            Text(countText)
                .font(.wagerMono(11))
                .foregroundColor(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(isWinner ? Color.wagerGoldFill.opacity(0.15) : Color.wagerCard)
        .overlay(
            RoundedRectangle(cornerRadius: WagerRadius.card)
                .stroke(isWinner ? Color.wagerGoldFill.opacity(0.4) : Color.wagerLine, lineWidth: 1)
        )
        .cornerRadius(WagerRadius.card)
    }

    // MARK: Open (can take a side)

    private var openSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Pick a side")
                    .font(.subheadline)
                    .foregroundColor(.wagerInkSecondary)
                Picker("Side", selection: $pickedSide) {
                    Text("Choose").tag(PickedSide.none)
                    Text(preview.sideA).tag(PickedSide.a)
                    Text(preview.sideB).tag(PickedSide.b)
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(preview.stakeAmount != nil ? "Amount (fixed stake)" : "Amount")
                    .font(.subheadline)
                    .foregroundColor(.wagerInkSecondary)
                HStack {
                    Text(WagerMoney.symbol(for: preview.paymentType)).foregroundColor(.wagerInkSecondary)
                    TextField("Amount", text: $amountText)
                        .keyboardType(.decimalPad)
                        .disabled(preview.stakeAmount != nil)
                }
                .padding(10)
                .background(Color.wagerCard)
                .overlay(
                    RoundedRectangle(cornerRadius: WagerRadius.control)
                        .stroke(Color.wagerLine, lineWidth: 1)
                )
                .cornerRadius(WagerRadius.control)
            }

            Button(action: confirm) {
                HStack {
                    if isSubmitting {
                        ProgressView().progressViewStyle(.circular).tint(.wagerOnEmerald)
                    }
                    Text(isSubmitting ? "Placing…" : "Confirm bet")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(pickedSide == .none ? Color.wagerLineStrong : Color.wagerEmerald)
                .foregroundColor(.wagerOnEmerald)
                .cornerRadius(WagerRadius.panel)
            }
            .disabled(pickedSide == .none || isSubmitting)

            Button("Open in WagerPals", action: onOpenInApp)
                .buttonStyle(.bordered)
                .tint(.wagerInkSecondary)
        }
    }

    // MARK: Closed / resolved (read-only)

    private var closedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(statusText)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.wagerInkSecondary)
            Button("Open in WagerPals", action: onOpenInApp)
                .buttonStyle(WagerPrimaryButtonStyle())
        }
    }

    private var statusText: String {
        if let winningSide = preview.winningSide {
            return "This wager is settled. \(winningSide) won."
        }
        return "This wager is \(preview.status) and no longer accepting bets."
    }

    // MARK: Networking

    private func refreshPreview() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fresh = try await WagerAPI.preview(eventId: preview.id, shareToken: shareToken)
            preview = fresh
            if let stake = fresh.stakeAmount {
                amountText = Self.formatAmount(stake)
            }
            refreshError = nil
        } catch {
            // Keep showing the snapshot decoded from the message bubble.
            refreshError = error.localizedDescription
        }
    }

    private func confirm() {
        guard let side = sideValue(pickedSide) else { return }
        let trimmedAmount = amountText.trimmingCharacters(in: .whitespaces)
        guard let amount = Double(trimmedAmount), amount > 0 else {
            submitError = "Enter a valid amount."
            return
        }

        isSubmitting = true
        submitError = nil
        needsSignIn = false
        Task { @MainActor in
            defer { isSubmitting = false }
            do {
                let response = try await WagerAPI.takeSide(
                    eventId: preview.id,
                    side: side,
                    amount: amount,
                    shareToken: shareToken
                )
                preview = response.preview
                onUpdated(response.preview)
            } catch WagerAPIError.notSignedIn {
                needsSignIn = true
            } catch WagerAPIError.http(_, let message) {
                submitError = message
            } catch {
                submitError = error.localizedDescription
            }
        }
    }

    private func sideValue(_ picked: PickedSide) -> String? {
        switch picked {
        case .a: return preview.sideA
        case .b: return preview.sideB
        case .none: return nil
        }
    }

    private static func formatAmount(_ value: Double) -> String {
        if value.truncatingRemainder(dividingBy: 1) == 0 {
            return String(format: "%.0f", value)
        }
        return String(format: "%.2f", value)
    }
}

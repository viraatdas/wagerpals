import SwiftUI

/// The expanded, full compose form for creating a new wager. Shares its
/// `WagerComposerDraft` with `CompactWagerView` so nothing typed in the
/// compact strip is lost when the user requests "More options".
struct ComposeWagerView: View {
    @ObservedObject var state: WagerExtensionState
    @ObservedObject var draft: WagerComposerDraft

    var onSend: (WagerCreateRequest) -> Void
    var onOpenApp: () -> Void

    @State private var validationError: String?

    var body: some View {
        Group {
            if state.signInStatus == .signedOut {
                WagerSignedOutView(onOpenApp: onOpenApp, compact: false)
            } else {
                form
            }
        }
        .onAppear { draft.seedDefaultGroupIfNeeded(groups: state.groups) }
        .onChange(of: state.groups) { groups in draft.seedDefaultGroupIfNeeded(groups: groups) }
        .onChange(of: draft.groupId) { _ in
            // Changing groups can strand a previously-tagged subject who
            // isn't a member of the new group — the server independently
            // re-validates and 400s on that, but resetting here means the
            // user never gets to submit a request that's guaranteed to fail.
            if let subjectUserId = draft.subjectUserId,
               !availableSubjects.contains(where: { $0.id == subjectUserId }) {
                draft.subjectUserId = nil
            }
        }
    }

    /// Members of the currently selected group who can be tagged as the
    /// subject of this bet. Excludes the signed-in user: tagging yourself as
    /// the subject of your own bet is legal server-side, but this control
    /// exists to call out someone *else* — showing yourself here would just
    /// be a confusing extra tap. Only ACTIVE members are ever present in the
    /// underlying `members` list (the server's guarantee, not filtered here).
    private var availableSubjects: [WagerGroupMember] {
        guard let groupId = draft.groupId,
              let group = state.groups.first(where: { $0.id == groupId }) else {
            return []
        }
        return group.members.filter { $0.id != state.identity?.id }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                fieldGroup("Wager title") {
                    TextField("e.g. Super Bowl LVIII", text: $draft.title)
                        .textFieldStyle(.roundedBorder)
                }

                HStack(spacing: 12) {
                    fieldGroup("Side A") {
                        TextField("e.g. Chiefs win", text: $draft.sideA)
                            .textFieldStyle(.roundedBorder)
                    }
                    fieldGroup("Side B") {
                        TextField("e.g. 49ers win", text: $draft.sideB)
                            .textFieldStyle(.roundedBorder)
                    }
                }

                fieldGroup("Group") {
                    WagerGroupPicker(groups: state.groups, selection: $draft.groupId)
                }

                fieldGroup("Deadline") {
                    Picker("Deadline", selection: $draft.quickDeadline) {
                        ForEach(QuickDeadline.allCases) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                fieldGroup("Payment") {
                    Picker("Payment", selection: $draft.paymentType) {
                        Text("Just for fun").tag(WagerPaymentType.none)
                        Text("Real money").tag(WagerPaymentType.cash)
                    }
                    .pickerStyle(.segmented)
                }

                if draft.paymentType == .cash {
                    fieldGroup("Stake per player") {
                        HStack {
                            Text(WagerMoney.symbol(for: .cash)).foregroundColor(.wagerInkSecondary)
                            TextField("Leave blank for open stakes", text: $draft.stakeText)
                                .keyboardType(.decimalPad)
                        }
                        .padding(10)
                        .background(Color.wagerCard)
                        .overlay(
                            RoundedRectangle(cornerRadius: WagerRadius.control)
                                .stroke(Color.wagerLine, lineWidth: 1)
                        )
                        .cornerRadius(WagerRadius.control)
                        Text("Leave blank and each bettor picks their own amount. Maximum $\(Int(WagerConstants.maxStake)) per bet.")
                            .font(.caption)
                            .foregroundColor(.wagerInkMuted)
                    }
                }

                // Subject tagging: GET /api/imessage/session now returns each
                // group's active member roster, so this picks a real person
                // rather than a placeholder. Options are scoped to the
                // currently selected group and exclude the signed-in user
                // (see `availableSubjects`); picking "No one" sends
                // subjectUserId = nil.
                fieldGroup("Tag someone from the app") {
                    Picker("Subject", selection: $draft.subjectUserId) {
                        Text("No one").tag(String?.none)
                        ForEach(availableSubjects) { member in
                            Text(member.username).tag(member.id as String?)
                        }
                    }
                    .pickerStyle(.menu)
                    .disabled(availableSubjects.isEmpty)

                    if availableSubjects.isEmpty {
                        Text(draft.groupId == nil ? "Pick a group first." : "No one else to tag in this group yet.")
                            .font(.caption)
                            .foregroundColor(.wagerInkMuted)
                    }
                }

                fieldGroup("Notify") {
                    Toggle("Let them know", isOn: $draft.notifySubject)
                        .tint(.wagerEmerald)
                        .disabled(draft.subjectUserId == nil)
                    Text("Only meaningful once someone is tagged. Turning it off makes the bet quiet.")
                        .font(.caption)
                        .foregroundColor(.wagerInkMuted)
                }

                fieldGroup("Your bet") {
                    Toggle("Take a side now", isOn: $draft.takeSideNow)
                        .tint(.wagerEmerald)
                    if draft.takeSideNow {
                        Picker("Side", selection: $draft.pickedSide) {
                            Text("No pick").tag(PickedSide.none)
                            if !draft.sideA.trimmingCharacters(in: .whitespaces).isEmpty {
                                Text(draft.sideA).tag(PickedSide.a)
                            }
                            if !draft.sideB.trimmingCharacters(in: .whitespaces).isEmpty {
                                Text(draft.sideB).tag(PickedSide.b)
                            }
                        }
                        .pickerStyle(.segmented)

                        HStack {
                            // The "Just for fun" payment type still escrows
                            // WagerPals' internal W currency (see
                            // lib/payments.ts), not literal dollars — the
                            // symbol here has to track `draft.paymentType`
                            // rather than always reading "$".
                            Text(WagerMoney.symbol(for: draft.paymentType)).foregroundColor(.wagerInkSecondary)
                            TextField("Amount", text: $draft.amountText)
                                .keyboardType(.decimalPad)
                        }
                        .padding(10)
                        .background(Color.wagerCard)
                        .overlay(
                            RoundedRectangle(cornerRadius: WagerRadius.control)
                                .stroke(Color.wagerLine, lineWidth: 1)
                        )
                        .cornerRadius(WagerRadius.control)
                    }
                }

                if let validationError = validationError {
                    WagerErrorBanner(message: validationError)
                }
                if let errorMessage = state.errorMessage {
                    WagerErrorBanner(message: errorMessage)
                }

                sendButton

                Spacer(minLength: 12)
            }
            .padding(20)
        }
        .background(Color.wagerPaper)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Create a wager")
                .font(.wagerDisplay(22))
                .foregroundColor(.wagerInk)
            if let identity = state.identity {
                Text("Signed in as \(identity.displayName ?? identity.username)")
                    .font(.caption)
                    .foregroundColor(.wagerAmberInk)
            }
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            HStack {
                if state.isSending {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.wagerOnEmerald)
                }
                Text(state.isSending ? "Starting…" : "Start the wager")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.wagerEmerald)
            .foregroundColor(.wagerOnEmerald)
            .cornerRadius(WagerRadius.panel)
        }
        .disabled(state.isSending)
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.wagerInkSecondary)
            content()
        }
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

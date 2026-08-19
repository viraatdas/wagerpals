import UIKit
import Messages
import SwiftUI

/// Observable session/network state shared by the compact and expanded
/// SwiftUI views. Owned by `MessagesViewController` and rebuilt fresh on
/// every activation.
@MainActor
final class WagerExtensionState: ObservableObject {
    enum SignInStatus: Equatable {
        case checking
        case signedIn
        case signedOut
    }

    @Published var signInStatus: SignInStatus = .checking
    @Published var identity: WagerSessionUser?
    @Published var groups: [WagerGroup] = []
    /// Every LIVE ("active") wager across the caller's groups, powering the
    /// compact-mode quick strip. Fetched by fanning out `GET
    /// /api/events?groupId=` per group (see `loadLiveEvents`) — there is no
    /// single "all my groups' wagers" endpoint.
    @Published var liveEvents: [WagerEventSummary] = []
    @Published var errorMessage: String?
    @Published var isSending: Bool = false
}

class MessagesViewController: MSMessagesAppViewController {

    private let state = WagerExtensionState()
    private let draft = WagerComposerDraft()

    // MARK: - Lifecycle

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)

        if WagerSessionStore.isSignedIn {
            // Seed immediately from the local cache so the compact strip is
            // never blank while the network calls below are in flight.
            state.groups = WagerLocalCache.cachedGroups()
            state.identity = WagerSessionStore.cachedIdentity()
            state.liveEvents = WagerLocalCache.cachedEvents()
            state.signInStatus = .checking
            draft.seedDefaultGroupIfNeeded(groups: state.groups)
            loadSession()
        } else {
            state.signInStatus = .signedOut
        }

        rebuildChild(for: conversation)
    }

    /// Dynamic updates, part 1: every time the extension actually becomes
    /// active (a fresh open, or coming back from the background) re-pull the
    /// session and live-wager odds so reopening never shows stale numbers.
    override func didBecomeActive(with conversation: MSConversation) {
        super.didBecomeActive(with: conversation)
        guard WagerSessionStore.isSignedIn else { return }
        loadSession()
    }

    /// Dynamic updates, part 2: refresh live-wager odds again right before a
    /// presentation-style change (e.g. compact -> expanded), so the quick
    /// strip reflects the latest state by the time it's visible.
    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.willTransition(to: presentationStyle)
        guard WagerSessionStore.isSignedIn else { return }
        loadLiveEvents()
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        guard let conversation = activeConversation else { return }
        rebuildChild(for: conversation)
    }

    // MARK: - Session loading

    private func loadSession() {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let payload = try await WagerAPI.session()
                self.state.identity = payload.user
                self.state.groups = payload.groups
                self.state.signInStatus = .signedIn
                self.state.errorMessage = nil
                WagerLocalCache.cacheGroups(payload.groups)
                self.draft.seedDefaultGroupIfNeeded(groups: payload.groups)
                self.loadLiveEvents()
            } catch WagerAPIError.notSignedIn {
                self.state.signInStatus = .signedOut
            } catch {
                // Network hiccup: keep whatever we already seeded from cache
                // (if any) rather than bouncing the user to a signed-out
                // screen, but surface the failure.
                self.state.errorMessage = error.localizedDescription
                self.state.signInStatus = self.state.groups.isEmpty ? .signedOut : .signedIn
            }
        }
    }

    /// Fans out `GET /api/events?groupId=` across the caller's groups (there
    /// is no single "all my groups' live wagers" endpoint — see the delivery
    /// report's API-gap note) and keeps only "active" events. Capped at the
    /// first 6 groups to bound both request count and the extension's
    /// memory/network footprint. One group's request failing never blanks
    /// the others — each fetch degrades to `[]` on its own rather than
    /// failing the whole batch.
    private func loadLiveEvents() {
        let boundedGroupIds = Array(state.groups.prefix(6).map { $0.id })
        guard !boundedGroupIds.isEmpty else {
            state.liveEvents = []
            return
        }

        Task { @MainActor [weak self] in
            guard let self = self else { return }
            let results = await withTaskGroup(of: [WagerEventSummary].self) { group -> [WagerEventSummary] in
                for groupId in boundedGroupIds {
                    group.addTask {
                        (try? await WagerAPI.eventsForGroup(groupId: groupId)) ?? []
                    }
                }
                var all: [WagerEventSummary] = []
                for await events in group {
                    all.append(contentsOf: events)
                }
                return all
            }
            let live = results.filter { $0.isOpen }
            self.state.liveEvents = live
            WagerLocalCache.cacheEvents(live)
        }
    }

    // MARK: - Child view management

    private func rebuildChild(for conversation: MSConversation) {
        // Remove any existing child properly before adding the new one.
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }

        let decoded = conversation.selectedMessage.flatMap { WagerMessageComposer.decode(from: $0) }
        let root = rootView(for: presentationStyle, conversation: conversation, decoded: decoded)
        embed(UIHostingController(rootView: root))
    }

    @ViewBuilder
    private func rootView(
        for style: MSMessagesAppPresentationStyle,
        conversation: MSConversation,
        decoded: (preview: WagerPreview, shareToken: String?)?
    ) -> some View {
        switch style {
        case .compact, .transcript:
            // `.transcript` (the static rendering shown in Messages history)
            // is treated the same as the compact strip — there's no
            // meaningful "expanded" interaction available from there.
            CompactWagerView(
                state: state,
                draft: draft,
                decoded: decoded,
                onRequestExpand: { [weak self] in self?.requestPresentationStyle(.expanded) },
                onOpenApp: { [weak self] in self?.openWagerPals() },
                onInsertExisting: { [weak self] preview in self?.insertExistingWager(preview, conversation: conversation) }
            )
        case .expanded:
            if let decoded = decoded {
                TakeSideView(
                    state: state,
                    initialPreview: decoded.preview,
                    shareToken: decoded.shareToken,
                    onUpdated: { [weak self] preview in
                        self?.handleTookSide(preview: preview, shareToken: decoded.shareToken, conversation: conversation)
                    },
                    onOpenInApp: { [weak self] in
                        self?.openInvite(eventId: decoded.preview.id, shareToken: decoded.shareToken)
                    }
                )
            } else {
                ComposeWagerView(
                    state: state,
                    draft: draft,
                    onSend: { [weak self] request in self?.sendNewWager(request, conversation: conversation) },
                    onOpenApp: { [weak self] in self?.openWagerPals() }
                )
            }
        @unknown default:
            CompactWagerView(
                state: state,
                draft: draft,
                decoded: decoded,
                onRequestExpand: { [weak self] in self?.requestPresentationStyle(.expanded) },
                onOpenApp: { [weak self] in self?.openWagerPals() },
                onInsertExisting: { [weak self] preview in self?.insertExistingWager(preview, conversation: conversation) }
            )
        }
    }

    private func embed<Content: View>(_ hosting: UIHostingController<Content>) {
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    // MARK: - Actions

    private func sendNewWager(_ request: WagerCreateRequest, conversation: MSConversation) {
        guard !state.isSending else { return }
        state.isSending = true
        state.errorMessage = nil

        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.state.isSending = false }
            do {
                let response = try await WagerAPI.createBet(request)
                // Brand-new wager: always a fresh MSSession so this becomes
                // its own bubble.
                let message = WagerMessageComposer.message(
                    for: response.preview,
                    shareToken: response.shareToken,
                    session: MSSession()
                )
                WagerLocalCache.lastGroupId = request.groupId
                try await conversation.insert(message)
                self.dismiss()
            } catch {
                self.state.errorMessage = error.localizedDescription
            }
        }
    }

    /// Tapped a live-wager card in the compact-mode quick strip: insert that
    /// already-existing wager into the conversation as a fresh bubble.
    ///
    /// This always uses a brand-new `MSSession` — this conversation has
    /// never carried a bubble for this wager before, so there's nothing to
    /// update in place (that's `handleTookSide`'s job, below). It also has
    /// no share token: tokens are only minted at creation time by `POST
    /// /api/imessage/bets` (see WagerAPI.createBet / lib/imessage-share.ts),
    /// and there's no server endpoint to mint one for an already-existing
    /// event. Recipients who are already active members of the wager's
    /// group can still take a side; anyone else gets the standard "you do
    /// not have access" response until they're added to the group some
    /// other way. Flagged as an API gap in the delivery report.
    private func insertExistingWager(_ preview: WagerPreview, conversation: MSConversation) {
        let message = WagerMessageComposer.message(for: preview, shareToken: nil, session: MSSession())
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                try await conversation.insert(message)
                self.dismiss()
            } catch {
                self.state.errorMessage = error.localizedDescription
            }
        }
    }

    private func handleTookSide(preview: WagerPreview, shareToken: String?, conversation: MSConversation) {
        // Reuse the existing bubble's MSSession so this insert REPLACES the
        // bubble in place. Using a fresh MSSession() here would spawn a
        // brand-new, duplicate bubble instead of updating the one the user
        // tapped to take a side on. This is the entire "dynamic update"
        // mechanism: MSMessage(session:) with the SAME session as the
        // selected message replaces that bubble for everyone in the thread
        // instead of stacking a new one.
        let session = conversation.selectedMessage?.session ?? MSSession()
        let message = WagerMessageComposer.message(for: preview, shareToken: shareToken, session: session)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                try await conversation.insert(message)
                self.dismiss()
            } catch {
                self.state.errorMessage = error.localizedDescription
            }
        }
    }

    private func openWagerPals() {
        // Opening the app requires the extension context — UIApplication is
        // unavailable inside an app extension.
        extensionContext?.open(WagerConfig.webBaseURL, completionHandler: nil)
    }

    private func openInvite(eventId: String, shareToken: String?) {
        // A universal link: opens the installed app directly, or falls back
        // to the web invite page (which itself offers the App Store) when
        // WagerPals isn't installed.
        extensionContext?.open(WagerConfig.inviteURL(eventId: eventId, shareToken: shareToken), completionHandler: nil)
    }
}

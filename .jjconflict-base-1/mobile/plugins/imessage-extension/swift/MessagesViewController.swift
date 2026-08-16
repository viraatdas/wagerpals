import UIKit
import Messages
import SwiftUI

class MessagesViewController: MSMessagesAppViewController {

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        presentComposeView(for: conversation)
    }

    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.willTransition(to: presentationStyle)
        guard let conversation = activeConversation else { return }
        presentComposeView(for: conversation)
    }

    private func presentComposeView(for conversation: MSConversation) {
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }

        if presentationStyle == .compact {
            showCompactView()
        } else {
            showExpandedView(for: conversation)
        }
    }

    private func showCompactView() {
        let button = UIButton(type: .system)
        button.setTitle("Create a Wager", for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        button.setTitleColor(.white, for: .normal)
        button.backgroundColor = UIColor(red: 37/255, green: 99/255, blue: 235/255, alpha: 1)
        button.layer.cornerRadius = 12
        button.addTarget(self, action: #selector(expandTapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            button.widthAnchor.constraint(equalToConstant: 200),
            button.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    @objc private func expandTapped() {
        requestPresentationStyle(.expanded)
    }

    private func showExpandedView(for conversation: MSConversation) {
        let composeView = ComposeWagerView { [weak self] title, sideA, sideB, pick, amount in
            self?.sendWager(title: title, sideA: sideA, sideB: sideB, pick: pick, amount: amount, conversation: conversation)
        }
        let hostingController = UIHostingController(rootView: composeView)
        addChild(hostingController)
        hostingController.view.frame = view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(hostingController.view)
        hostingController.didMove(toParent: self)
    }

    private func sendWager(title: String, sideA: String, sideB: String, pick: String?, amount: String?, conversation: MSConversation) {
        let message = WagerMessageComposer.compose(title: title, sideA: sideA, sideB: sideB, pick: pick, amount: amount)
        conversation.insert(message) { error in
            if let error = error {
                print("Failed to insert message: \(error)")
            }
        }
        dismiss()
    }
}

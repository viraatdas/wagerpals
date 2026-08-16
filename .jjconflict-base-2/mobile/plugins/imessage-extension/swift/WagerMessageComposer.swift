import Messages
import Foundation

struct WagerMessageComposer {
    static func compose(title: String, sideA: String, sideB: String, pick: String?, amount: String?) -> MSMessage {
        let message = MSMessage()
        let layout = MSMessageTemplateLayout()

        layout.caption = "🎲 \(title)"
        layout.subcaption = "\(sideA)  vs  \(sideB)"
        if let pick = pick, !pick.isEmpty, let amount = amount, !amount.isEmpty {
            layout.trailingSubcaption = "\(pick) · $\(amount)"
        } else if let pick = pick, !pick.isEmpty {
            layout.trailingSubcaption = "Pick: \(pick)"
        } else {
            layout.trailingSubcaption = "Tap to wager"
        }

        message.layout = layout

        var components = URLComponents(string: "https://wagerpals.io/invite")!
        var queryItems = [
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "sideA", value: sideA),
            URLQueryItem(name: "sideB", value: sideB),
        ]
        if let pick = pick, !pick.isEmpty {
            queryItems.append(URLQueryItem(name: "pick", value: pick))
        }
        if let amount = amount, !amount.isEmpty {
            queryItems.append(URLQueryItem(name: "amount", value: amount))
        }
        components.queryItems = queryItems
        message.url = components.url

        if let pick = pick, !pick.isEmpty, let amount = amount, !amount.isEmpty {
            message.summaryText = "Wager: $\(amount) on \(pick)"
        } else {
            message.summaryText = "Wager invite: \(title)"
        }

        return message
    }
}

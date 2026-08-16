import SwiftUI

struct ComposeWagerView: View {
    @State private var eventTitle = ""
    @State private var sideA = ""
    @State private var sideB = ""
    @State private var selectedPick = ""
    @State private var amount = ""

    var onSend: (String, String, String, String?, String?) -> Void

    private var isValid: Bool {
        !eventTitle.trimmingCharacters(in: .whitespaces).isEmpty &&
        !sideA.trimmingCharacters(in: .whitespaces).isEmpty &&
        !sideB.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Create a Wager")
                .font(.title2)
                .fontWeight(.bold)
                .padding(.top, 24)

            VStack(alignment: .leading, spacing: 6) {
                Text("Event Title")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                TextField("e.g. Super Bowl LVIII", text: $eventTitle)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Side A")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                TextField("e.g. Chiefs win", text: $sideA)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Side B")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                TextField("e.g. 49ers win", text: $sideB)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Your Bet")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Picker("Pick", selection: $selectedPick) {
                    Text("No pick yet").tag("")
                    if !sideA.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text(sideA).tag(sideA)
                    }
                    if !sideB.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text(sideB).tag(sideB)
                    }
                }
                .pickerStyle(.segmented)

                HStack {
                    Text("$")
                        .foregroundColor(.secondary)
                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)
                }
                .padding(10)
                .background(Color(.systemGray6))
                .cornerRadius(10)
            }

            Button(action: {
                onSend(
                    eventTitle.trimmingCharacters(in: .whitespaces),
                    sideA.trimmingCharacters(in: .whitespaces),
                    sideB.trimmingCharacters(in: .whitespaces),
                    selectedPick.trimmingCharacters(in: .whitespaces).isEmpty ? nil : selectedPick.trimmingCharacters(in: .whitespaces),
                    amount.trimmingCharacters(in: .whitespaces).isEmpty ? nil : amount.trimmingCharacters(in: .whitespaces)
                )
            }) {
                Text("Send Wager")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(isValid ? Color(red: 37/255, green: 99/255, blue: 235/255) : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .disabled(!isValid)

            Spacer()
        }
        .padding(.horizontal, 24)
    }
}

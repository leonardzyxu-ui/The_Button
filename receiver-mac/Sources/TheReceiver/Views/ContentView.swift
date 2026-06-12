import SwiftUI
import TheReceiverCore

struct ContentView: View {
    @EnvironmentObject private var store: ReceiverStore
    @State private var replyDraft = ""
    @State private var showingPermanentDelete = false

    var body: some View {
        Group {
            if store.isConfigured {
                dashboard
            } else {
                SetupView()
            }
        }
        .preferredColorScheme(.dark)
    }

    private var dashboard: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            VStack(spacing: 12) {
                topGrid
                conversationPane
            }
            .padding(14)
            .background(Color(red: 0.04, green: 0.06, blue: 0.08))
        }
        .sheet(isPresented: $showingPermanentDelete) {
            PermanentDeleteSheet()
                .environmentObject(store)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("The Receiver")
                .font(.system(size: 24, weight: .bold))
                .padding(.bottom, 12)

            SidebarButton(title: "Dashboard", systemImage: "speedometer", selected: true)
            SidebarButton(title: "Requests", systemImage: "tray.full", badge: deletedCount)
            SidebarButton(title: "Conversations", systemImage: "bubble.left.and.bubble.right")
            SidebarButton(title: "Settings", systemImage: "gearshape")

            Spacer()

            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Circle()
                        .fill(store.connectionStatus == "Connected" ? .green : .blue)
                        .frame(width: 9, height: 9)
                    Text(store.connectionStatus)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                Text("v0.1.0")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(width: 190)
        .background(Color(red: 0.035, green: 0.05, blue: 0.065))
    }

    private var topGrid: some View {
        HStack(spacing: 12) {
            Panel(title: "Online \(store.onlineDevices.isEmpty ? "" : "•")") {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.devices) { device in
                            DeviceRow(device: device, selected: store.selectedDeviceID == device.deviceId) {
                                store.selectedDeviceID = device.deviceId
                            }
                        }
                    }
                }
            }

            Panel(title: "Events") {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.events.suffix(24).reversed()) { event in
                            EventRow(event: event)
                        }
                    }
                }
            }

            Panel(title: "Conversations") {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.activeDevices) { device in
                            ConversationRow(
                                device: device,
                                preview: lastPreview(for: device.deviceId),
                                selected: store.selectedDeviceID == device.deviceId
                            ) {
                                store.selectedDeviceID = device.deviceId
                            }
                        }
                    }
                }
            }
        }
        .frame(minHeight: 260)
    }

    private var conversationPane: some View {
        Panel(title: store.selectedDevice?.displayName ?? "No conversation") {
            VStack(spacing: 0) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if store.selectedMessages.isEmpty {
                            Text("No messages yet.")
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 18)
                        } else {
                            ForEach(store.selectedMessages) { message in
                                MessageBubble(message: message)
                            }
                        }
                    }
                    .padding(.vertical, 12)
                }

                Divider()

                HStack(spacing: 10) {
                    TextField("Type a reply...", text: $replyDraft)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                    Button {
                        store.sendReply(replyDraft)
                        replyDraft = ""
                    } label: {
                        Image(systemName: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(replyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.selectedDevice == nil)

                    Button(role: .destructive) {
                        store.deleteSelected()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .disabled(store.selectedDevice == nil)

                    Button(role: .destructive) {
                        showingPermanentDelete = true
                    } label: {
                        Label("Permanent Delete", systemImage: "trash.slash")
                    }
                    .disabled(store.selectedDevice == nil)
                }
                .padding(.top, 12)
            }
        }
        .frame(minHeight: 260)
    }

    private var deletedCount: Int? {
        let count = store.devices.filter { $0.status == "deleted" }.count
        return count > 0 ? count : nil
    }

    private func lastPreview(for deviceId: String) -> String {
        store.messages.last { $0.deviceId == deviceId }?.text ?? "No messages yet"
    }
}

struct ReceiverSettingsView: View {
    @EnvironmentObject private var store: ReceiverStore
    @State private var token = ""
    @State private var adminPassword = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("The Receiver Settings")
                .font(.title2.bold())

            TextField("Relay URL", text: $store.relayURL)
                .textFieldStyle(.roundedBorder)

            SecureField("Receiver token", text: $token)
                .textFieldStyle(.roundedBorder)

            SecureField("Permanent Delete admin password", text: $adminPassword)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Save and Connect") {
                    if !token.isEmpty {
                        store.receiverToken = token
                    }
                    if !adminPassword.isEmpty {
                        store.adminPassword = adminPassword
                    }
                    store.saveSettings()
                }
                .buttonStyle(.borderedProminent)

                Button("Enable Notifications") {
                    store.requestNotifications()
                }
            }

            Text(store.notificationStatus)
                .foregroundStyle(.secondary)
            Text(store.connectionStatus)
                .foregroundStyle(.secondary)
        }
        .onAppear {
            token = store.receiverToken
            adminPassword = store.adminPassword
        }
    }
}

private struct SetupView: View {
    @EnvironmentObject private var store: ReceiverStore
    @State private var token = ""
    @State private var adminPassword = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("The Receiver")
                .font(.system(size: 42, weight: .heavy))
            Text("Connect this Mac to The Button relay.")
                .foregroundStyle(.secondary)

            TextField("Relay URL", text: $store.relayURL)
                .textFieldStyle(.roundedBorder)
            SecureField("Receiver token", text: $token)
                .textFieldStyle(.roundedBorder)
            SecureField("Permanent Delete admin password", text: $adminPassword)
                .textFieldStyle(.roundedBorder)

            Button("Save and Connect") {
                store.receiverToken = token
                store.adminPassword = adminPassword
                store.saveSettings()
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.relayURL.isEmpty || token.isEmpty || adminPassword.isEmpty)

            Text(store.connectionStatus)
                .foregroundStyle(.secondary)
        }
        .padding(42)
        .frame(maxWidth: 560, maxHeight: .infinity)
        .onAppear {
            token = store.receiverToken
            adminPassword = store.adminPassword
        }
    }
}

private struct SidebarButton: View {
    let title: String
    let systemImage: String
    var selected = false
    var badge: Int?

    var body: some View {
        HStack {
            Image(systemName: systemImage)
                .frame(width: 20)
            Text(title)
            Spacer()
            if let badge {
                Text(String(badge))
                    .font(.caption.bold())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.blue, in: Capsule())
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 38)
        .background(selected ? Color.white.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.headline)
                .padding(12)
            Divider()
            content
                .padding(.horizontal, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.065, green: 0.09, blue: 0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.white.opacity(0.12))
        )
    }
}

private struct DeviceRow: View {
    let device: ButtonDevice
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.white.opacity(0.18))
                    .overlay(Text(String(device.displayName.prefix(1))).font(.headline))
                    .frame(width: 36, height: 36)
                VStack(alignment: .leading) {
                    Text(device.displayName)
                        .fontWeight(.semibold)
                    Text(device.status == "active" ? (device.online ? "Online" : "Offline") : device.status.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Circle()
                    .fill(device.online ? Color.green : statusColor(device.status))
                    .frame(width: 8, height: 8)
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .background(selected ? Color.white.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct EventRow: View {
    let event: ButtonEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(event.text)
                    .foregroundStyle(event.type == "nuke" ? Color.red : Color.primary)
                    .fontWeight(event.type == "nuke" ? .bold : .regular)
                Spacer()
                Text(shortTime(event.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Divider()
        }
        .padding(.vertical, 8)
    }
}

private struct ConversationRow: View {
    let device: ButtonDevice
    let preview: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Circle()
                    .fill(Color.white.opacity(0.18))
                    .overlay(Text(String(device.displayName.prefix(1))).font(.headline))
                    .frame(width: 36, height: 36)
                VStack(alignment: .leading) {
                    Text(device.displayName)
                        .fontWeight(.semibold)
                    Text(preview)
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .background(selected ? Color.white.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct MessageBubble: View {
    let message: ButtonMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(message.from == "leo" ? "Leo" : message.displayName)
                    .font(.caption.bold())
                    .foregroundStyle(message.from == "leo" ? Color.blue : Color.red)
                Text(shortTime(message.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(message.text)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PermanentDeleteSheet: View {
    @EnvironmentObject private var store: ReceiverStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var phrase = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Permanent Delete")
                .font(.title2.bold())
            Text("This blocks the saved browser device identity from sending The Button requests again.")
                .foregroundStyle(.secondary)
            SecureField("Receiver admin password", text: $password)
                .textFieldStyle(.roundedBorder)
            TextField("Type PERMANENT DELETE", text: $phrase)
                .textFieldStyle(.roundedBorder)

            if !store.lastError.isEmpty {
                Text(store.lastError)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                Spacer()
                Button("Permanent Delete", role: .destructive) {
                    if store.permanentDeleteSelected(password: password, phrase: phrase) {
                        dismiss()
                    }
                }
                .disabled(password.isEmpty || phrase != "PERMANENT DELETE")
            }
        }
        .padding(22)
        .frame(width: 420)
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "deleted":
        return .orange
    case "banned":
        return .red
    default:
        return .gray
    }
}

private func shortTime(_ iso: String) -> String {
    if iso.count >= 16 {
        let start = iso.index(iso.startIndex, offsetBy: 11)
        let end = iso.index(start, offsetBy: 5)
        return String(iso[start..<end])
    }
    return iso
}


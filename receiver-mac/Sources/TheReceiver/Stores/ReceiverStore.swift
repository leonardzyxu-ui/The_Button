import AppKit
import Foundation
import SwiftUI
import TheReceiverCore

@MainActor
final class ReceiverStore: ObservableObject {
    @Published var relayURL: String
    @Published var receiverToken: String = ""
    @Published var adminPassword: String = ""
    @Published var devices: [ButtonDevice] = []
    @Published var events: [ButtonEvent] = []
    @Published var messages: [ButtonMessage] = []
    @Published var bans: [ButtonBan] = []
    @Published var records: [CriminalRecord] = []
    @Published var selectedDeviceID: String?
    @Published var connectionStatus = "Disconnected"
    @Published var notificationStatus = "Notifications not checked."
    @Published var lastError = ""

    var onNuke: ((String, String?) -> Void)?

    private let client = ReceiverRelayClient()

    var isConfigured: Bool {
        !relayURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !receiverToken.isEmpty
            && !adminPassword.isEmpty
    }

    var onlineDevices: [ButtonDevice] {
        devices.filter { $0.status == "active" && $0.online }
    }

    var activeDevices: [ButtonDevice] {
        devices.filter { $0.status == "active" }
    }

    var pendingDevices: [ButtonDevice] {
        devices.filter { $0.status == "pending" }
    }

    var deletedDevices: [ButtonDevice] {
        devices.filter { $0.status == "deleted" }
    }

    var bannedDevices: [ButtonDevice] {
        devices.filter { $0.status == "banned" }
    }

    var selectedDevice: ButtonDevice? {
        guard let selectedDeviceID else { return activeDevices.first }
        return devices.first { $0.deviceId == selectedDeviceID }
    }

    var selectedMessages: [ButtonMessage] {
        guard let id = selectedDevice?.deviceId else { return [] }
        return messages.filter { $0.deviceId == id }
    }

    init() {
        relayURL = UserDefaults.standard.string(forKey: "relayURL") ?? "http://127.0.0.1:8787"
        receiverToken = KeychainStore.load("receiverToken")
        adminPassword = KeychainStore.load("adminPassword")
        client.onStatus = { [weak self] status in
            Task { @MainActor in
                self?.connectionStatus = status
            }
        }
        client.onEnvelope = { [weak self] envelope in
            Task { @MainActor in
                self?.handle(envelope)
            }
        }
    }

    func saveSettings() {
        UserDefaults.standard.set(relayURL, forKey: "relayURL")
        KeychainStore.save(receiverToken, key: "receiverToken")
        KeychainStore.save(adminPassword, key: "adminPassword")
        connect()
    }

    func connect() {
        guard isConfigured else {
            connectionStatus = "Needs setup"
            return
        }
        client.connect(baseURL: relayURL, token: receiverToken)
    }

    func disconnect() {
        client.disconnect()
        connectionStatus = "Disconnected"
    }

    func requestNotifications() {
        MacNotificationService.shared.requestAuthorization { [weak self] _, message in
            Task { @MainActor in
                self?.notificationStatus = message
            }
        }
    }

    func sendTestNotification() {
        deliverNotification(
            title: "The Button",
            body: "Test notification from The Receiver."
        )
    }

    func sendReply(_ text: String) {
        guard let device = selectedDevice else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        client.send(ReceiverOutbound(type: "reply", deviceId: device.deviceId, text: trimmed))
    }

    func approveSelected() {
        guard let device = selectedDevice else { return }
        client.send(ReceiverOutbound(type: "approveDevice", deviceId: device.deviceId))
    }

    func reviveSelected() {
        guard let device = selectedDevice else { return }
        client.send(ReceiverOutbound(type: "reviveDevice", deviceId: device.deviceId))
    }

    func deleteSelected() {
        guard let device = selectedDevice else { return }
        client.send(ReceiverOutbound(type: "deleteDevice", deviceId: device.deviceId))
    }

    func permanentDeleteSelected(password: String, phrase: String) -> Bool {
        guard let device = selectedDevice else { return false }
        guard password == adminPassword, phrase == "PERMANENT DELETE" else {
            lastError = "Permanent Delete confirmation failed."
            return false
        }
        client.send(ReceiverOutbound(type: "banDevice", deviceId: device.deviceId))
        return true
    }

    private func handle(_ envelope: ReceiverEnvelope) {
        if let snapshot = envelope.snapshot {
            apply(snapshot)
        }
        if let event = envelope.event {
            client.send(ReceiverOutbound(type: "eventReceived", eventId: event.id))
            appendEvent(event)
            notify(for: event)
        }
        if let message = envelope.message {
            appendMessage(message)
            if message.from == "user" {
                deliverNotification(
                    title: "The Button",
                    body: "\(message.displayName): \(message.text)"
                )
            }
        }
        if let record = envelope.record {
            appendRecord(record)
        }
    }

    private func apply(_ snapshot: ReceiverSnapshot) {
        devices = snapshot.users
        events = snapshot.events
        messages = snapshot.messages
        bans = snapshot.bans ?? []
        records = snapshot.records ?? []
        if selectedDeviceID == nil || !devices.contains(where: { $0.deviceId == selectedDeviceID }) {
            selectedDeviceID = activeDevices.first?.deviceId ?? devices.first?.deviceId
        }
    }

    private func appendEvent(_ event: ButtonEvent) {
        guard !events.contains(where: { $0.id == event.id }) else { return }
        events.append(event)
        if events.count > 300 {
            events.removeFirst(events.count - 300)
        }
    }

    private func appendMessage(_ message: ButtonMessage) {
        guard !messages.contains(where: { $0.id == message.id }) else { return }
        messages.append(message)
        if messages.count > 600 {
            messages.removeFirst(messages.count - 600)
        }
        if selectedDeviceID == nil {
            selectedDeviceID = message.deviceId
        }
    }

    private func appendRecord(_ record: CriminalRecord) {
        guard !records.contains(where: { $0.id == record.id }) else { return }
        records.append(record)
        if records.count > 300 {
            records.removeFirst(records.count - 300)
        }
        if record.type == "send_ban" {
            deliverNotification(
                title: "Send Ban",
                body: "\(record.displayName) was blocked for 3 minutes."
            )
        }
    }

    private func notify(for event: ButtonEvent) {
        switch event.type {
        case "press":
            deliverNotification(title: "The Button", body: event.text)
        case "message":
            deliverNotification(title: "Message Leo", body: event.text)
        case "nuke":
            deliverNotification(title: "The Nuke", body: event.text)
            NSApp.activate(ignoringOtherApps: true)
            onNuke?(event.displayName, event.nukeMessage)
        case "sendBan":
            deliverNotification(title: "Send Ban", body: event.text)
        default:
            break
        }
    }

    private func deliverNotification(title: String, body: String) {
        MacNotificationService.shared.deliver(title: title, body: body) { [weak self] success, message in
            Task { @MainActor in
                self?.notificationStatus = success ? "Last notification sent." : message
            }
        }
    }
}

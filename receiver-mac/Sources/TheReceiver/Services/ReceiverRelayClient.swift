import Foundation
import TheReceiverCore

final class ReceiverRelayClient: NSObject, URLSessionWebSocketDelegate {
    var onEnvelope: ((ReceiverEnvelope) -> Void)?
    var onStatus: ((String) -> Void)?

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private var task: URLSessionWebSocketTask?
    private var baseURL = ""
    private var token = ""
    private var manuallyDisconnected = true
    private var reconnectWorkItem: DispatchWorkItem?
    private var pingTimer: DispatchSourceTimer?

    func connect(baseURL: String, token: String) {
        disconnect()
        self.baseURL = baseURL
        self.token = token
        manuallyDisconnected = false
        openSocket()
    }

    func disconnect() {
        manuallyDisconnected = true
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        stopPing()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    func send(_ outbound: ReceiverOutbound) {
        do {
            let data = try encoder.encode(outbound)
            guard let text = String(data: data, encoding: .utf8) else {
                return
            }
            task?.send(.string(text)) { [weak self] error in
                if let error {
                    self?.emitStatus(error.localizedDescription)
                }
            }
        } catch {
            emitStatus(error.localizedDescription)
        }
    }

    private func openSocket() {
        do {
            let url = try ReceiverURLBuilder.websocketURL(baseURL: baseURL, token: token)
            let request = URLRequest(url: url)
            let next = session.webSocketTask(with: request)
            task = next
            next.resume()
            receiveLoop(for: next)
            startPing()
            emitStatus("Connecting")
        } catch {
            emitStatus("Invalid relay URL")
        }
    }

    private func receiveLoop(for task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.task === task else { return }
            switch result {
            case .success(let message):
                self.handle(message)
                self.receiveLoop(for: task)
            case .failure(let error):
                self.emitStatus(error.localizedDescription)
                self.scheduleReconnect()
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        do {
            let data: Data
            switch message {
            case .string(let text):
                data = Data(text.utf8)
            case .data(let payload):
                data = payload
            @unknown default:
                return
            }
            let envelope = try decoder.decode(ReceiverEnvelope.self, from: data)
            if envelope.type == "error", let error = envelope.errorMessage {
                emitStatus(error)
            }
            onEnvelope?(envelope)
        } catch {
            emitStatus(error.localizedDescription)
        }
    }

    private func scheduleReconnect() {
        guard !manuallyDisconnected else { return }
        stopPing()
        reconnectWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.openSocket()
        }
        reconnectWorkItem = item
        emitStatus("Reconnecting")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: item)
    }

    private func startPing() {
        stopPing()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + 20, repeating: 20)
        timer.setEventHandler { [weak self] in
            self?.send(ReceiverOutbound(type: "ping", at: ISO8601DateFormatter().string(from: Date())))
        }
        pingTimer = timer
        timer.resume()
    }

    private func stopPing() {
        pingTimer?.cancel()
        pingTimer = nil
    }

    private func emitStatus(_ status: String) {
        DispatchQueue.main.async { [onStatus] in
            onStatus?(status)
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        emitStatus("Connected")
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error {
            emitStatus(error.localizedDescription)
        }
        scheduleReconnect()
    }
}


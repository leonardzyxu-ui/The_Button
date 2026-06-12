import Foundation
import TheReceiverCore

enum CheckError: Error {
    case failed(String)
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() {
        throw CheckError.failed(message)
    }
}

func testDecodesSnapshotEnvelope() throws {
    let json = """
    {
      "type": "snapshot",
      "generatedAt": "2026-06-12T00:00:00.000Z",
      "receiverOnline": true,
      "users": [{
        "deviceId": "btn_abc",
        "displayName": "Alex",
        "status": "active",
        "online": true,
        "createdAt": "2026-06-12T00:00:00.000Z",
        "updatedAt": "2026-06-12T00:00:00.000Z",
        "lastSeenAt": "2026-06-12T00:00:00.000Z",
        "counts": { "presses": 1, "messages": 2, "nukes": 0 }
      }],
      "events": [],
      "messages": [],
      "totals": { "users": 1, "online": 1, "events": 0, "messages": 0 }
    }
    """.data(using: .utf8)!

    let envelope = try JSONDecoder().decode(ReceiverEnvelope.self, from: json)
    try check(envelope.type == "snapshot", "snapshot type did not decode")
    try check(envelope.snapshot?.users.first?.displayName == "Alex", "snapshot user did not decode")
}

func testDecodesNukeEventEnvelope() throws {
    let json = """
    {
      "type": "event",
      "event": {
        "id": "evt_1",
        "createdAt": "2026-06-12T00:00:00.000Z",
        "type": "nuke",
        "deviceId": "btn_abc",
        "displayName": "Alex",
        "text": "Alex has nuked you."
      }
    }
    """.data(using: .utf8)!

    let envelope = try JSONDecoder().decode(ReceiverEnvelope.self, from: json)
    try check(envelope.event?.type == "nuke", "nuke event type did not decode")
    try check(envelope.event?.text == "Alex has nuked you.", "nuke event text did not decode")
}

func testBuildsReceiverWebSocketURL() throws {
    let url = try ReceiverURLBuilder.websocketURL(baseURL: "https://example.onrender.com", token: "secret")
    try check(url.absoluteString == "wss://example.onrender.com/ws/receiver?token=secret", "receiver websocket URL was wrong")
}

let checks: [(String, () throws -> Void)] = [
    ("snapshot envelope", testDecodesSnapshotEnvelope),
    ("nuke event envelope", testDecodesNukeEventEnvelope),
    ("receiver websocket URL", testBuildsReceiverWebSocketURL)
]

var failures: [String] = []
for (name, checkBody) in checks {
    do {
        try checkBody()
        print("PASS \(name)")
    } catch {
        failures.append("\(name): \(error)")
    }
}

if !failures.isEmpty {
    for failure in failures {
        print("FAIL \(failure)")
    }
    exit(1)
}

print("All TheReceiver checks passed.")


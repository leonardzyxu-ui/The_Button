import Foundation

public struct ButtonCounts: Codable, Equatable {
    public var presses: Int
    public var messages: Int
    public var nukes: Int

    public init(presses: Int = 0, messages: Int = 0, nukes: Int = 0) {
        self.presses = presses
        self.messages = messages
        self.nukes = nukes
    }
}

public struct ButtonDevice: Codable, Identifiable, Equatable {
    public var id: String { deviceId }
    public let deviceId: String
    public let displayName: String
    public let status: String
    public let online: Bool
    public let createdAt: String
    public let updatedAt: String
    public let lastSeenAt: String
    public let counts: ButtonCounts

    public init(
        deviceId: String,
        displayName: String,
        status: String = "active",
        online: Bool = false,
        createdAt: String,
        updatedAt: String,
        lastSeenAt: String,
        counts: ButtonCounts = ButtonCounts()
    ) {
        self.deviceId = deviceId
        self.displayName = displayName
        self.status = status
        self.online = online
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastSeenAt = lastSeenAt
        self.counts = counts
    }
}

public struct ButtonEvent: Codable, Identifiable, Equatable {
    public let id: String
    public let createdAt: String
    public let type: String
    public let deviceId: String
    public let displayName: String
    public let text: String

    public init(id: String, createdAt: String, type: String, deviceId: String, displayName: String, text: String) {
        self.id = id
        self.createdAt = createdAt
        self.type = type
        self.deviceId = deviceId
        self.displayName = displayName
        self.text = text
    }
}

public struct ButtonMessage: Codable, Identifiable, Equatable {
    public let id: String
    public let createdAt: String
    public let deviceId: String
    public let displayName: String
    public let from: String
    public let text: String

    public init(id: String, createdAt: String, deviceId: String, displayName: String, from: String, text: String) {
        self.id = id
        self.createdAt = createdAt
        self.deviceId = deviceId
        self.displayName = displayName
        self.from = from
        self.text = text
    }
}

public struct ReceiverTotals: Codable, Equatable {
    public let users: Int
    public let online: Int
    public let events: Int
    public let messages: Int

    public init(users: Int = 0, online: Int = 0, events: Int = 0, messages: Int = 0) {
        self.users = users
        self.online = online
        self.events = events
        self.messages = messages
    }
}

public struct ReceiverSnapshot: Codable, Equatable {
    public let type: String?
    public let generatedAt: String
    public let receiverOnline: Bool
    public let users: [ButtonDevice]
    public let events: [ButtonEvent]
    public let messages: [ButtonMessage]
    public let totals: ReceiverTotals

    public init(
        type: String? = "snapshot",
        generatedAt: String,
        receiverOnline: Bool,
        users: [ButtonDevice],
        events: [ButtonEvent],
        messages: [ButtonMessage],
        totals: ReceiverTotals = ReceiverTotals()
    ) {
        self.type = type
        self.generatedAt = generatedAt
        self.receiverOnline = receiverOnline
        self.users = users
        self.events = events
        self.messages = messages
        self.totals = totals
    }
}

public struct ReceiverEnvelope: Decodable {
    public let type: String
    public let snapshot: ReceiverSnapshot?
    public let event: ButtonEvent?
    public let message: ButtonMessage?
    public let errorMessage: String?

    private enum CodingKeys: String, CodingKey {
        case type
        case snapshot
        case event
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        if type == "snapshot" {
            snapshot = try? ReceiverSnapshot(from: decoder)
        } else {
            snapshot = try? container.decode(ReceiverSnapshot.self, forKey: .snapshot)
        }
        event = try? container.decode(ButtonEvent.self, forKey: .event)
        message = try? container.decode(ButtonMessage.self, forKey: .message)
        if type == "error" {
            errorMessage = try? container.decode(String.self, forKey: .message)
        } else {
            errorMessage = nil
        }
    }
}

public struct ReceiverOutbound: Encodable, Equatable {
    public let type: String
    public let deviceId: String?
    public let text: String?
    public let at: String?

    public init(type: String, deviceId: String? = nil, text: String? = nil, at: String? = nil) {
        self.type = type
        self.deviceId = deviceId
        self.text = text
        self.at = at
    }
}

public enum ReceiverURLBuilder {
    public static func websocketURL(baseURL: String, token: String) throws -> URL {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed), !token.isEmpty else {
            throw ReceiverCoreError.invalidURL
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + ([basePath, "ws", "receiver"].filter { !$0.isEmpty }.joined(separator: "/"))
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else {
            throw ReceiverCoreError.invalidURL
        }
        return url
    }
}

public enum ReceiverCoreError: Error, Equatable {
    case invalidURL
}

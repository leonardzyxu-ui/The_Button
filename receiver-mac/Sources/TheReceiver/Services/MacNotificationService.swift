import AppKit
import Foundation
import UserNotifications

final class MacNotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = MacNotificationService()

    private let center = UNUserNotificationCenter.current()

    private override init() {
        super.init()
    }

    func configure() {
        center.delegate = self
    }

    func requestAuthorization(completion: @escaping (Bool, String) -> Void) {
        center.getNotificationSettings { [center] settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional:
                DispatchQueue.main.async {
                    completion(true, "Notifications are enabled.")
                }
            case .denied:
                DispatchQueue.main.async {
                    completion(false, "Notifications are blocked in System Settings.")
                }
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                    DispatchQueue.main.async {
                        if let error {
                            completion(false, error.localizedDescription)
                        } else if granted {
                            completion(true, "Notifications enabled.")
                        } else {
                            completion(false, "Notifications were not allowed.")
                        }
                    }
                }
            @unknown default:
                DispatchQueue.main.async {
                    completion(false, "Could not read notification permission.")
                }
            }
        }
    }

    func deliver(title: String, body: String, completion: ((Bool, String) -> Void)? = nil) {
        center.getNotificationSettings { [center] settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional:
                self.addNotification(center: center, title: title, body: body, completion: completion)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                    if let error {
                        DispatchQueue.main.async {
                            completion?(false, error.localizedDescription)
                        }
                    } else if granted {
                        self.addNotification(center: center, title: title, body: body, completion: completion)
                    } else {
                        DispatchQueue.main.async {
                            completion?(false, "Notifications were not allowed.")
                        }
                    }
                }
            case .denied:
                DispatchQueue.main.async {
                    completion?(false, "Notifications are blocked in System Settings.")
                }
            @unknown default:
                DispatchQueue.main.async {
                    completion?(false, "Could not read notification permission.")
                }
            }
        }
    }

    private func addNotification(
        center: UNUserNotificationCenter,
        title: String,
        body: String,
        completion: ((Bool, String) -> Void)?
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = "the-button"
        let request = UNNotificationRequest(
            identifier: "the-button-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request) { error in
            DispatchQueue.main.async {
                if let error {
                    completion?(false, error.localizedDescription)
                } else {
                    completion?(true, "Notification sent.")
                }
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }
}

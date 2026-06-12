import SwiftUI

@main
struct TheReceiverApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = ReceiverStore()

    var body: some Scene {
        WindowGroup("The Receiver") {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 980, minHeight: 650)
                .onAppear {
                    store.onNuke = { name, message in
                        NukeOverlayWindowController.shared.show(name: name, message: message)
                    }
                    store.requestNotifications()
                    store.connect()
                }
        }
        .commands {
            CommandMenu("Receiver") {
                Button("Reconnect") {
                    store.connect()
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])

                Button("Show Test Nuke Overlay") {
                    NukeOverlayWindowController.shared.show(name: "Test", message: "This is what a Nuke message will look like.")
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }

        Settings {
            ReceiverSettingsView()
                .environmentObject(store)
                .frame(width: 520)
                .padding(22)
        }
    }
}

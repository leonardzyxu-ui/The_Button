import AppKit
import SwiftUI

@MainActor
final class NukeOverlayWindowController {
    static let shared = NukeOverlayWindowController()

    private var window: NSPanel?
    private var eventMonitor: Any?

    private init() {}

    func show(name: String) {
        hide()
        let screenFrame = (NSScreen.main ?? NSScreen.screens.first)?.frame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let panel = NSPanel(
            contentRect: screenFrame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        let view = NukeOverlayView(name: name) { [weak self] in
            self?.hide()
        }
        panel.contentViewController = NSHostingController(rootView: view)
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.backgroundColor = .red
        panel.isOpaque = true
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.setFrame(screenFrame, display: true)
        window = panel
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {
                self?.hide()
                return nil
            }
            return event
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
    }

    func hide() {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
        window?.orderOut(nil)
        window = nil
    }
}

private struct NukeOverlayView: View {
    let name: String
    let dismiss: () -> Void

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.02, blue: 0.02),
                    Color(red: 0.72, green: 0.0, blue: 0.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text("\(name) has nuked you.")
                .font(.system(size: 64, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.2), radius: 24, x: 0, y: 10)
                .multilineTextAlignment(.center)
                .padding(48)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: dismiss)
    }
}


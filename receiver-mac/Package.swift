// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "TheReceiver",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "TheReceiver", targets: ["TheReceiver"]),
        .executable(name: "TheReceiverChecks", targets: ["TheReceiverChecks"]),
        .library(name: "TheReceiverCore", targets: ["TheReceiverCore"])
    ],
    targets: [
        .target(
            name: "TheReceiverCore",
            path: "Sources/TheReceiverCore"
        ),
        .executableTarget(
            name: "TheReceiver",
            dependencies: ["TheReceiverCore"],
            path: "Sources/TheReceiver"
        ),
        .executableTarget(
            name: "TheReceiverChecks",
            dependencies: ["TheReceiverCore"],
            path: "Sources/TheReceiverChecks"
        )
    ]
)

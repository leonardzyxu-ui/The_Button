import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("Assets", isDirectory: true)
let output = assets.appendingPathComponent("TheReceiverIcon-1024.png")

try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)

let size = 1024
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
let nsContext = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = nsContext
let ctx = nsContext.cgContext
ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))

func ellipsePath(center: CGPoint, radius: CGFloat) -> CGPath {
    CGPath(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2), transform: nil)
}

func fillEllipse(center: CGPoint, radius: CGFloat, color: NSColor) {
    ctx.addPath(ellipsePath(center: center, radius: radius))
    ctx.setFillColor(color.cgColor)
    ctx.fillPath()
}

let center = CGPoint(x: 512, y: 512)

fillEllipse(center: CGPoint(x: 512, y: 535), radius: 428, color: NSColor(calibratedRed: 0.13, green: 0.0, blue: 0.0, alpha: 0.22))
fillEllipse(center: center, radius: 408, color: NSColor(calibratedRed: 0.32, green: 0.03, blue: 0.04, alpha: 0.82))
fillEllipse(center: center, radius: 388, color: NSColor(calibratedRed: 0.55, green: 0.02, blue: 0.03, alpha: 1.0))
fillEllipse(center: center, radius: 372, color: NSColor(calibratedRed: 1.0, green: 0.22, blue: 0.22, alpha: 1.0))

ctx.saveGState()
ctx.addPath(ellipsePath(center: center, radius: 354))
ctx.clip()
let colors = [
    NSColor(calibratedRed: 1.0, green: 0.24, blue: 0.24, alpha: 1).cgColor,
    NSColor(calibratedRed: 0.96, green: 0.08, blue: 0.09, alpha: 1).cgColor,
    NSColor(calibratedRed: 0.62, green: 0.03, blue: 0.04, alpha: 1).cgColor
] as CFArray
let locations: [CGFloat] = [0.0, 0.45, 1.0]
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: locations)!
ctx.drawRadialGradient(
    gradient,
    startCenter: CGPoint(x: 395, y: 315),
    startRadius: 40,
    endCenter: center,
    endRadius: 460,
    options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
)
ctx.restoreGState()

ctx.setLineWidth(11)
ctx.setStrokeColor(NSColor(calibratedRed: 1.0, green: 0.44, blue: 0.44, alpha: 0.22).cgColor)
ctx.addPath(ellipsePath(center: center, radius: 315))
ctx.strokePath()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 150, weight: .heavy),
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph
]

("The" as NSString).draw(in: CGRect(x: 0, y: 508, width: size, height: 170), withAttributes: attributes)
("Button" as NSString).draw(in: CGRect(x: 0, y: 352, width: size, height: 180), withAttributes: attributes)

NSGraphicsContext.restoreGraphicsState()

guard let data = rep.representation(using: .png, properties: [:]) else {
    fatalError("Could not create PNG data")
}
try data.write(to: output)

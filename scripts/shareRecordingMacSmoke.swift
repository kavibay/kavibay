// Called by video_macos::tests::native_mp4_roundtrip, or:
// swift scripts/shareRecordingMacSmoke.swift <test-clip.mp4>
// Reads a synthetic clip through Apple's decoder; uses a private pasteboard.
import AVFoundation
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: url)
let video = asset.tracks(withMediaType: .video)
precondition(video.count == 1 && asset.tracks(withMediaType: .audio).isEmpty)
precondition(abs(asset.duration.seconds - 5) < 0.01, "Clip must last five seconds")
precondition(video[0].naturalSize == CGSize(width: 320, height: 180))
let description = video[0].formatDescriptions[0] as! CMFormatDescription
precondition(CMFormatDescriptionGetMediaSubType(description) == kCMVideoCodecType_H264)

let generator = AVAssetImageGenerator(asset: asset)
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
func color(_ seconds: Double, _ x: Int, _ y: Int) throws -> NSColor {
    let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 1000), actualTime: nil)
    return NSBitmapImageRep(cgImage: image).colorAt(x: x, y: y)!.usingColorSpace(.sRGB)!
}
let top = try color(0, 160, 30)
let bottom = try color(0, 160, 150)
let end = try color(4.999, 160, 90)
precondition(top.redComponent > 0.8 && top.blueComponent < 0.2, "Red/blue channels or orientation are wrong")
precondition(bottom.blueComponent > 0.8 && bottom.redComponent < 0.2, "Bottom of frame was flipped")
precondition(end.greenComponent > 0.8 && end.redComponent < 0.2, "Last interaction is missing")

let pasteboard = NSPasteboard.withUniqueName()
defer { pasteboard.releaseGlobally() }
precondition(pasteboard.writeObjects([url as NSURL]))
let copied = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL]
precondition(copied == [url], "Native video file paste did not roundtrip")
print("shareRecordingMacSmoke: ok (H.264 MP4, 5 seconds, dimensions, decoded colors, interaction, final frame, file clipboard)")

#!/usr/bin/env swift
//
// Renders the device icons in assets/devices/ from SF Symbols.
//
// Why not Raycast's built-in Icon set? Because it can't tell these devices apart:
//   - Icon.Keyboard renders as a robot face at 16px
//   - Icon.Mouse is a featureless rounded rectangle
//   - an Apple Watch and an iPhone both report kind "mobile", and Raycast has no watch glyph,
//     so they drew the IDENTICAL icon
//
// AirBuddy itself draws its device glyphs with SF Symbols at runtime (its Assets.car contains no
// bundled device art — verified), so this matches the app we're a companion to.
//
// Usage:  swift scripts/render-icons.swift
// Output: assets/devices/<name>.png and <name>@dark.png, 64x64, transparent.
//
// Re-run this only when the symbol list below changes. The PNGs are committed.

import AppKit

// (SF Symbol name, output basename)
// Every symbol here is verified to exist on macOS 26. `magictrackpad` does NOT exist under any
// name — `rectangle.and.hand.point.up.left` (a trackpad with a hand on it) is the closest true match.
let symbols: [(String, String)] = [
  ("airpodspro", "airpods-pro"),
  ("airpods", "airpods"),
  ("airpodsmax", "airpods-max"),
  ("beats.headphones", "beats"),
  ("headphones", "headphones"),
  ("laptopcomputer", "mac-laptop"),
  ("desktopcomputer", "mac-desktop"),
  ("iphone", "iphone"),
  ("ipad", "ipad"),
  ("applewatch", "watch"),
  ("keyboard", "keyboard"),
  ("magicmouse", "mouse"),
  ("rectangle.and.hand.point.up.left", "trackpad"),
  ("hifispeaker", "speaker"),
  ("display", "display"),

  // Battery level glyphs. Raycast's Icon.Battery is a single static outline; these fill by charge,
  // which is what AirBuddy's own menu bar does and what a user actually reads at a glance.
  ("battery.0percent", "battery-0"),
  ("battery.25percent", "battery-25"),
  ("battery.50percent", "battery-50"),
  ("battery.75percent", "battery-75"),
  ("battery.100percent", "battery-100"),
  ("battery.100percent.bolt", "battery-charging"),

  // Listening modes — matching the glyphs AirBuddy draws in its own Noise Control menu:
  // Off = plain person; Noise Cancellation = person enclosed; Transparency = person open to
  // surroundings; Adaptive = person + sparkle.
  ("person.fill", "mode-off"),
  ("person.crop.circle.fill", "mode-anc"),
  ("person.and.background.dotted", "mode-transparency"),
  ("person.wave.2.fill", "mode-adaptive"),
]

let outDir = "assets/devices"
let canvas: CGFloat = 64 // Raycast draws list icons small; 64 covers @2x at 32pt.
let pointSize: CGFloat = 40

func render(symbol: String, basename: String, tint: NSColor, suffix: String) -> Bool {
  let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)
  guard let base = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
    .withSymbolConfiguration(config)
  else {
    FileHandle.standardError.write("MISSING SYMBOL: \(symbol)\n".data(using: .utf8)!)
    return false
  }

  let out = NSImage(size: NSSize(width: canvas, height: canvas))
  out.lockFocus()
  NSGraphicsContext.current?.imageInterpolation = .high

  let rect = NSRect(
    x: (canvas - base.size.width) / 2,
    y: (canvas - base.size.height) / 2,
    width: base.size.width,
    height: base.size.height
  )
  tint.set()
  base.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1.0)
  rect.fill(using: .sourceAtop) // tint the glyph, preserve its alpha
  out.unlockFocus()

  guard let tiff = out.tiffRepresentation,
    let rep = NSBitmapImageRep(data: tiff),
    let png = rep.representation(using: .png, properties: [:])
  else { return false }

  try? png.write(to: URL(fileURLWithPath: "\(outDir)/\(basename)\(suffix).png"))
  return true
}

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

var ok = 0
var missing: [String] = []
for (symbol, basename) in symbols {
  // Raycast serves @dark to dark-mode users. Light mode wants a dark glyph and vice versa.
  let light = render(symbol: symbol, basename: basename, tint: .black, suffix: "")
  let dark = render(symbol: symbol, basename: basename, tint: .white, suffix: "@dark")
  if light && dark { ok += 1 } else { missing.append(symbol) }
}

print("rendered \(ok)/\(symbols.count) symbols (light + dark) into \(outDir)/")
if !missing.isEmpty {
  print("MISSING: \(missing.joined(separator: ", "))")
  exit(1)
}

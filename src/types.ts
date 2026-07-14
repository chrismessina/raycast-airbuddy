import { Color, Icon } from "@raycast/api";

export type DeviceKind = "headset" | "mobile" | "accessory" | "host" | "Mac";
export type DeviceDistance = "unknown" | "immediate" | "near" | "far";
export type DeviceSource = "local" | "nearby host" | "cloud";
export type AudioState = "idle" | "listening" | "call" | "microphone in use";
export type ListeningMode = "normal" | "noise cancellation" | "transparency" | "adaptive";
export type SpatialAudioMode = "off" | "fixed" | "head tracked";
export type BatteryPosition = "main" | "combined buds" | "left bud" | "right bud" | "charging case";
export type ChargingState = "discharging" | "charging" | "AC power" | "smart charging";
export type BatteryAlertKind = "low battery" | "charged";

export interface Battery {
  position: BatteryPosition;
  level: number;
  chargingState: ChargingState;
  low: boolean;
  unreliable: boolean;
}

export interface BatteryAlert {
  kind: BatteryAlertKind;
  position: BatteryPosition;
  threshold: number;
  enabled: boolean;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  model: string;
  brand: string;
  address: string;
  connected: boolean;
  nearby: boolean;
  distance: DeviceDistance;
  source: DeviceSource;
  audioState: AudioState;
  inputRoute: boolean;
  outputRoute: boolean;
  /**
   * DO NOT READ THIS DIRECTLY. AirBuddy answers `listening mode` for every device,
   * including devices with no speakers — a Magic Trackpad reports "transparency".
   * Always gate on `supportsListeningMode(device)` first. See spec constraint 3.
   */
  listeningMode: ListeningMode;
  supportedListeningModes: ListeningMode[];
  leftBudInEar: boolean;
  rightBudInEar: boolean;
  anyBudInEar: boolean;
  anyBudInCase: boolean;
  caseLidClosed: boolean;
  batteries: Battery[];
  alerts: BatteryAlert[];
}

export interface AppState {
  spatialAudioMode: SpatialAudioMode;
  currentOutputName: string | null;
  currentInputName: string | null;
  nearestHeadsetName: string | null;
  favoriteHeadsetName: string | null;
}

/**
 * The ONLY sanctioned way to ask whether a device has listening modes.
 * A trackpad reports listeningMode: "transparency" with supportedListeningModes: [].
 */
export function supportsListeningMode(device: Device): boolean {
  return device.supportedListeningModes.length > 0;
}

/**
 * Whether this device can carry an audio route — i.e. whether audio actions (Spatial Audio) make
 * any sense on it.
 *
 * Spatial Audio is an APPLICATION-level property in AirBuddy's API (it applies to the current
 * output route, not to a device you pick), so a per-device "Toggle Spatial Audio" action is global
 * state wearing a device costume. Offering it on a keyboard row is a category error — AirBuddy
 * accepts the command, silently no-ops it, and the user is left wondering what happened.
 *
 * Gated on properties AirBuddy actually reports, not on a name or a kind guess: a headset, or
 * anything currently serving as an audio route. A trackpad satisfies neither.
 */
export function isAudioDevice(device: Device): boolean {
  return device.kind === "headset" || device.outputRoute || device.inputRoute;
}

/** The battery to show as the headline number. Headsets report combined buds; everything else, main. */
export function primaryBattery(device: Device): Battery | undefined {
  return (
    device.batteries.find((b) => b.position === "combined buds") ?? device.batteries.find((b) => b.position === "main")
  );
}

export function caseBattery(device: Device): Battery | undefined {
  return device.batteries.find((b) => b.position === "charging case");
}

/** Show left/right separately only when they meaningfully differ. AirBuddy shows one number otherwise. */
export function budsDiverge(device: Device): boolean {
  const left = device.batteries.find((b) => b.position === "left bud");
  const right = device.batteries.find((b) => b.position === "right bud");
  if (!left || !right) return false;
  return Math.abs(left.level - right.level) >= 5;
}

/**
 * Section titles mirror AirBuddy's own Devices panel.
 *
 * The `default` matters: `DeviceKind` is hand-mirrored from AirBuddy's sdef and the JXA payload is
 * cast rather than validated, so a kind AirBuddy adds tomorrow reaches this function at runtime with
 * no compile error. Without the fallback it would return `undefined`, and the list — which groups by
 * this value and renders only known section titles — would drop the device entirely, with no error
 * anywhere. A visible "Other Devices" section is strictly better than a device that vanishes.
 */
export function sectionFor(device: Device): string {
  switch (device.kind) {
    case "headset":
      return "AirPods";
    case "host":
    case "Mac":
      return "Macs";
    case "mobile":
      return "iPhones, iPads, and Apple Watch";
    case "accessory":
      return "Keyboards, Mice, and Other Peripherals";
    default:
      return OTHER_SECTION;
  }
}

/** Fallback section for a device kind AirBuddy adds that we don't know about yet. */
export const OTHER_SECTION = "Other Devices";

/**
 * `kind` is "accessory" for both keyboards and pointing devices, so the split keys off the name.
 *
 * An earlier version also matched `model.startsWith("Device1,6")` for keyboards. That was dropped:
 * it was inferred from a single sample (`Device1,671`), it ran BEFORE the pointer check, and a
 * Magic Mouse in the same `Device1,6xx` range would have been given a keyboard icon. Both real
 * devices classify correctly by name alone, so the model clause bought nothing and risked being
 * wrong. If a device is unnamed or oddly named, `Icon.Devices` is an honest fallback.
 *
 * `default` is unreachable today, but `DeviceKind` is hand-mirrored from AirBuddy's sdef and the
 * JXA payload is cast, not validated — so a kind AirBuddy adds tomorrow arrives at runtime without
 * a compile error. Falling through to `undefined` would drop the device from the UI silently.
 */
export function iconFor(device: Device): Icon {
  switch (device.kind) {
    case "headset":
      return Icon.Airpods;
    case "host":
    case "Mac":
      return Icon.Desktop;
    case "mobile":
      return Icon.Mobile;
    case "accessory":
      if (/keyboard/i.test(device.name)) return Icon.Keyboard;
      if (/trackpad|mouse/i.test(device.name)) return Icon.Mouse;
      return Icon.Devices;
    default:
      return Icon.Devices;
  }
}

export function batteryColor(battery: Battery): Color {
  if (battery.level < 20) return Color.Red;
  if (battery.level < 40) return Color.Orange;
  return Color.SecondaryText;
}

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

/** The battery to show as the headline number. Headsets report combined buds; everything else, main. */
export function primaryBattery(device: Device): Battery | undefined {
  return (
    device.batteries.find((b) => b.position === "combined buds") ??
    device.batteries.find((b) => b.position === "main")
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

/** Section titles mirror AirBuddy's own Devices panel. */
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
  }
}

/**
 * `kind` is "accessory" for both keyboards and trackpads, so the split keys off the
 * model identifier. Observed: Device1,671 = keyboard, Device1,804 = Magic Trackpad.
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
      if (/keyboard/i.test(device.name) || device.model.startsWith("Device1,6")) return Icon.Keyboard;
      if (/trackpad|mouse/i.test(device.name)) return Icon.Mouse;
      return Icon.Devices;
  }
}

export function batteryColor(battery: Battery): Color {
  if (battery.level < 20) return Color.Red;
  if (battery.level < 40) return Color.Orange;
  return Color.SecondaryText;
}

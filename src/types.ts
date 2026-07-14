import { Color } from "@raycast/api";

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
 * Device icons are SF Symbols, rendered to `assets/devices/` by `scripts/render-icons.swift`.
 *
 * Raycast's built-in `Icon` enum can't tell these devices apart: `Icon.Keyboard` renders as a robot
 * face at 16px, `Icon.Mouse` is a featureless rounded rectangle, and an Apple Watch and an iPhone
 * both report `kind: "mobile"` — with no watch glyph in the enum, they drew the IDENTICAL icon.
 *
 * AirBuddy itself draws its device glyphs with SF Symbols at runtime (its Assets.car ships no device
 * art — verified), so this matches the app we're a companion to.
 *
 * Discrimination uses `model` where `kind` is too coarse. Real values observed on live hardware:
 *   Mac15,8 (MacBook Pro) · V54AP (iPhone board id) · AirPodsPro1,3 · Device1,671 · Device1,804
 */
function deviceAsset(basename: string): { source: { light: string; dark: string } } {
  return {
    source: {
      light: `devices/${basename}.png`,
      dark: `devices/${basename}@dark.png`,
    },
  };
}

function assetNameFor(device: Device): string {
  const name = device.name.toLowerCase();
  const model = device.model.toLowerCase();

  switch (device.kind) {
    case "headset":
      if (/airpodsmax|max/.test(model) || /max/.test(name)) return "airpods-max";
      if (/airpodspro|pro/.test(model) || /pro/.test(name)) return "airpods-pro";
      if (/airpod/.test(model) || /airpod/.test(name)) return "airpods";
      if (device.brand.toLowerCase().includes("beats") || /beats/.test(name)) return "beats";
      return "headphones";

    case "host":
    case "Mac":
      // MacBooks report MacBookPro*/MacBookAir*/Mac*,* — a laptop is the safe default for a Mac
      // that AirBuddy sees over Bluetooth, but honour an explicit desktop when we can tell.
      if (/imac|macmini|macpro|macstudio/.test(model) || /imac|mini|studio|pro display/.test(name)) {
        return "mac-desktop";
      }
      return "mac-laptop";

    case "mobile":
      // The case Raycast's enum could not express: AirBuddy reports Watch AND iPhone as "mobile".
      if (/watch/.test(model) || /watch/.test(name)) return "watch";
      if (/ipad/.test(model) || /ipad/.test(name)) return "ipad";
      return "iphone";

    case "accessory":
      if (/keyboard/.test(name)) return "keyboard";
      if (/trackpad/.test(name)) return "trackpad";
      if (/mouse/.test(name)) return "mouse";
      if (/speaker|homepod/.test(name)) return "speaker";
      if (/display|monitor/.test(name)) return "display";
      return "keyboard";

    default:
      // `DeviceKind` is hand-mirrored from AirBuddy's sdef and the JXA payload is cast, not
      // validated — a kind AirBuddy adds tomorrow arrives at runtime with no compile error.
      return "headphones";
  }
}

export function iconFor(device: Device): { source: { light: string; dark: string } } {
  return deviceAsset(assetNameFor(device));
}

export function batteryColor(battery: Battery): Color {
  if (battery.level < 20) return Color.Red;
  if (battery.level < 40) return Color.Orange;
  return Color.SecondaryText;
}

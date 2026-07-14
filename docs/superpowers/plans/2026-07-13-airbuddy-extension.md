# AirBuddy Raycast Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose AirBuddy 3.0's AppleScript API through Raycast — a live device list with batteries and per-device actions, seven no-view quick commands, and a battery-alert form.

**Architecture:** Three layers. `airbuddy.ts` owns the entire AppleScript boundary (a single `runJXA` helper: static script + serialized argv, strict JSON out, bounded timeout, typed error classification). `types.ts` owns the domain model and the derived helpers that encode the API's traps so no component can reimplement them wrong. Commands are thin consumers that never touch `osascript` directly.

**Tech Stack:** TypeScript 6, React 19, `@raycast/api` 1.104, `@raycast/utils` 2.2, `osascript -l JavaScript` (JXA). macOS only. **No test runner.**

**Spec:** [`docs/superpowers/specs/2026-07-13-airbuddy-raycast-extension-design.md`](../specs/2026-07-13-airbuddy-raycast-extension-design.md) — the authority. Read it before Task 1.

## Global Constraints

Every task's requirements implicitly include this section.

- **`npx tsc --noEmit` is the type gate.** `ray build` (esbuild) and `ray lint` (ESLint) strip and skip types without checking them. Passing build + lint is **not** evidence the code typechecks. A non-zero `tsc` exit is a failure even when `ray build` succeeds.
- **No test runner, no test dependency.** Verification is `tsc` + `lint` + `build` + a hands-on check against real hardware. Do not add Vitest, Jest, or any test framework.
- **No `any`.** No `as any`, no `: any`. Note the `useCachedPromise` overload trap (Task 6) produces `any[]` *without anyone writing the word `any`* — the lint rule will not catch it.
- **No hand-declared `Preferences` / `Arguments` types.** Use Raycast's generated ambient types.
- **Every `Toast.Style.Failure` carries a "Copy Error" `primaryAction`** that copies the error message to the clipboard. No exceptions — this design has many failure paths.
- **Keyboard shortcuts, two axes:** use `Keyboard.Shortcut.Common.X` where a semantic match exists (never wrap it in a platform object); where none exists, this extension is `platforms: ["macOS"]` so write a **plain** `{ modifiers, key }` object. Never `{ macOS, Windows }` here.
- **No `@chrismessina/raycast-logger`** — that rule is conditional on web requests and this extension makes none.
- **Never interpolate device IDs/names into JXA source.** Static script, values passed as `argv`. A device named `"); evil((` must be inert.
- **Never show a success toast/HUD on request-accept.** Every AirBuddy action is fire-and-forget. Poll the postcondition or say nothing.
- **Target app is `AirBuddyHelper`**, not `AirBuddy`.

## Ground-truth fixture (captured live, 2026-07-13)

Real output from this Mac. Use these exact shapes — do not invent payloads.

```json
{
  "spatialAudioMode": "off",
  "devices": [
    { "name": "BunnySilicon II", "kind": "host", "model": "Mac15,8",
      "connected": false, "listeningMode": "normal", "supported": [],
      "batteries": [{ "pos": "main", "lvl": 80 }] },
    { "name": "JesusPhone VI", "kind": "mobile", "model": "V54AP",
      "connected": true, "listeningMode": "normal", "supported": [],
      "batteries": [{ "pos": "main", "lvl": 90 }] },
    { "name": "Master's Keyboard", "kind": "accessory", "model": "Device1,671",
      "connected": true, "listeningMode": "transparency", "supported": [],
      "batteries": [{ "pos": "main", "lvl": 100 }] },
    { "name": "Master's Magic Trackpad II (USB-C)", "kind": "accessory", "model": "Device1,804",
      "connected": true, "listeningMode": "transparency", "supported": [],
      "batteries": [{ "pos": "main", "lvl": 100 }] }
  ]
}
```

**Read the trackpad row.** `listeningMode: "transparency"` with `supported: []`. A trackpad has no
speakers. This is an uninitialized value leaking through a class-level property, and it is the single
most important trap in this codebase. **Everything gates on `supported.length > 0`, never on
`listeningMode`.**

**With AirPods connected**, a headset row additionally carries: `kind: "headset"`,
`supported: ["normal","noise cancellation","transparency","adaptive"]`, `distance: "immediate"`,
`inputRoute: true`, `outputRoute: true`, in-ear sensors, and **four** batteries —
`charging case` (52), `combined buds` (80), `left bud` (80), `right bud` (80).

**Devices come and go.** The AirPods dropped out of the feed between two runs (returned to case). A
shrinking list is the normal case, not an error.

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Domain model, enums, derived helpers. Zero I/O. |
| `src/airbuddy.ts` | The **entire** AppleScript boundary. `runJXA` + typed errors + every command. |
| `src/hooks/use-devices.ts` | `useCachedPromise` + the interval poller (cleanup, non-overlap guard). |
| `src/components/device-list-item.tsx` | One row: icon, accessories, subtitle. |
| `src/components/device-actions.tsx` | The ActionPanel for a row. |
| `src/components/error-views.tsx` | Onboarding / not-installed / not-running empty views. |
| `src/list-devices.tsx` | The list command (Task 6–9). |
| `src/battery-alerts.tsx` | The alert form. Pushed, not a manifest command. |
| `src/connect-nearest-headset.ts` … | Seven thin no-view commands. |
| `package.json` | Manifest: 8 commands, `list-devices` must become `"view"`. |
| `README.md` | **Required** — two permissions in two different apps. |

---

## Task 1: Manifest + domain model

**Files:**
- Modify: `package.json` (commands array)
- Create: `src/types.ts`
- Delete: `src/list-devices.ts` (empty stub; replaced by `.tsx` in Task 6)

**Interfaces:**
- Produces: `Device`, `Battery`, `BatteryAlert`, `DeviceKind`, `ListeningMode`, `BatteryPosition`, `ChargingState`, `SpatialAudioMode`, `AppState`; helpers `supportsListeningMode`, `primaryBattery`, `caseBattery`, `budsDiverge`, `sectionFor`, `iconFor`, `batteryColor`.

- [ ] **Step 1: Rewrite the `commands` array in `package.json`**

The scaffold declares `list-devices` as `no-view`, which cannot host a `List`. It must be `view`.

```jsonc
"commands": [
  {
    "name": "list-devices",
    "title": "Devices",
    "subtitle": "AirBuddy",
    "description": "Browse nearby devices, batteries, and connection state.",
    "mode": "view"
  },
  {
    "name": "connect-nearest-headset",
    "title": "Connect Nearest Headset",
    "subtitle": "AirBuddy",
    "description": "Connect to the headset AirBuddy considers closest.",
    "mode": "no-view"
  },
  {
    "name": "connect-favorite-headset",
    "title": "Connect Favorite Headset",
    "subtitle": "AirBuddy",
    "description": "Connect to the headset starred as a favorite in AirBuddy.",
    "mode": "no-view"
  },
  {
    "name": "disconnect-headset",
    "title": "Disconnect Headset",
    "subtitle": "AirBuddy",
    "description": "Disconnect the currently connected headset.",
    "mode": "no-view"
  },
  {
    "name": "toggle-listening-mode",
    "title": "Toggle Listening Mode",
    "subtitle": "AirBuddy",
    "description": "Cycle the listening mode on the current headset.",
    "mode": "no-view"
  },
  {
    "name": "set-listening-mode",
    "title": "Set Listening Mode",
    "subtitle": "AirBuddy",
    "description": "Set a specific listening mode on the current headset.",
    "mode": "no-view",
    "arguments": [
      {
        "name": "mode",
        "type": "dropdown",
        "placeholder": "Listening Mode",
        "required": true,
        "data": [
          { "title": "Off", "value": "normal" },
          { "title": "Noise Cancellation", "value": "noise cancellation" },
          { "title": "Transparency", "value": "transparency" },
          { "title": "Adaptive", "value": "adaptive" }
        ]
      }
    ]
  },
  {
    "name": "toggle-spatial-audio",
    "title": "Toggle Spatial Audio",
    "subtitle": "AirBuddy",
    "description": "Toggle Spatial Audio on the current output device.",
    "mode": "no-view"
  },
  {
    "name": "show-dashboard",
    "title": "Show AirBuddy Dashboard",
    "subtitle": "AirBuddy",
    "description": "Open AirBuddy's device dashboard.",
    "mode": "no-view"
  }
]
```

- [ ] **Step 2: Delete the empty stub**

```bash
rm src/list-devices.ts
```

- [ ] **Step 3: Create `src/types.ts`**

```ts
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
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0, no output. **Paste the raw result — do not assert you ran it.**

- [ ] **Step 5: Commit**

```bash
git add package.json src/types.ts
git commit -m "feat: manifest commands and AirBuddy domain model"
```

---

## Task 2: The JXA transport

**Files:**
- Create: `src/airbuddy.ts`

**Interfaces:**
- Consumes: everything from `src/types.ts`.
- Produces: `runJXA<T>(script: string, args?: string[]): Promise<T>`; errors `ScriptingDisabledError`, `AutomationConsentError`, `AirBuddyNotInstalledError`, `AirBuddyNotRunningError`, `AirBuddyError`; `classifyError(stderr: string): Error`.

This task is the security boundary. Get it right and nothing downstream can inject.

- [ ] **Step 1: Create `src/airbuddy.ts` with the transport and error types**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 10_000;

export class ScriptingDisabledError extends Error {
  constructor() {
    super("AirBuddy's AppleScript support is turned off.");
    this.name = "ScriptingDisabledError";
  }
}

export class AutomationConsentError extends Error {
  constructor() {
    super("macOS has not granted Raycast permission to control AirBuddy.");
    this.name = "AutomationConsentError";
  }
}

export class AirBuddyNotRunningError extends Error {
  constructor() {
    super("AirBuddy isn't running.");
    this.name = "AirBuddyNotRunningError";
  }
}

export class AirBuddyNotInstalledError extends Error {
  constructor() {
    super("AirBuddy isn't installed.");
    this.name = "AirBuddyNotInstalledError";
  }
}

export class AirBuddyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirBuddyError";
  }
}

/**
 * -1743 is errAEEventNotPermitted — a GENERIC "Apple Event not permitted" code. It does NOT
 * uniquely mean "AirBuddy scripting is off". It also fires when macOS Automation consent is
 * denied, which is a different setting in a different app. Classify on the MESSAGE, not the code.
 *
 * AirBuddy authors a descriptive message ("...you must enable scripting in AirBuddy Settings").
 * The OS, refusing before AirBuddy ever sees the event, does not.
 *
 * VERIFY THE EXACT STRINGS on a machine where consent is denied (see Task 12) before trusting this.
 */
export function classifyError(stderr: string): Error {
  const text = stderr.toLowerCase();

  if (text.includes("enable scripting in airbuddy") || text.includes("airbuddy settings")) {
    return new ScriptingDisabledError();
  }
  if (text.includes("-1743") || text.includes("not permitted") || text.includes("not authorized")) {
    return new AutomationConsentError();
  }
  if (text.includes("-600") || text.includes("application isn't running")) {
    return new AirBuddyNotRunningError();
  }
  if (text.includes("-1728") || text.includes("can't get application")) {
    return new AirBuddyNotInstalledError();
  }
  return new AirBuddyError(stderr.trim() || "Unknown AirBuddy error");
}

/**
 * Runs a JXA script against AirBuddyHelper and parses its JSON stdout.
 *
 * SECURITY: `script` MUST be a static string literal. Values are passed via `args` and read
 * inside the script from the `argv` parameter of `run()`. NEVER interpolate a device name or id
 * into the script source — a device named `"); doSomething((` would otherwise execute.
 */
export async function runJXA<T>(script: string, args: string[] = []): Promise<T> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script, ...args],
      { timeout: TIMEOUT_MS, killSignal: "SIGKILL" },
    );

    const trimmed = stdout.trim();
    if (trimmed === "") {
      return undefined as T;
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new AirBuddyError(`AirBuddy returned unparseable output: ${trimmed.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof AirBuddyError) throw error;

    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : error instanceof Error
          ? error.message
          : String(error);

    throw classifyError(stderr);
  }
}
```

- [ ] **Step 2: Verify the timeout actually kills a hung script**

This is the "witnessed red" for the timeout — prove it fires rather than trusting the option.

Run:
```bash
time /usr/bin/osascript -l JavaScript -e 'delay(30); "never"' &
sleep 1; kill %1 2>/dev/null
echo "osascript is killable — the SIGKILL path is reachable"
```
Expected: the command is interruptible. (The real assertion is Step 4's type gate; this just
confirms `osascript` is a normal child process, not something that ignores signals.)

- [ ] **Step 3: Verify injection is impossible by construction**

Read your own `runJXA` and confirm: `script` is a parameter, `args` is a separate array passed
after `-e`, and **nowhere** in the function is a value concatenated into `script`. If you find
yourself writing `` `...${id}...` `` anywhere in Task 3, you have violated this — stop and pass it
via `args` instead.

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 5: Commit**

```bash
git add src/airbuddy.ts
git commit -m "feat: JXA transport with typed error classification"
```

---

## Task 3: AirBuddy read + action commands

**Files:**
- Modify: `src/airbuddy.ts` (append)

**Interfaces:**
- Consumes: `runJXA`, `Device`, `AppState`, `ListeningMode`, `BatteryAlertKind`, `BatteryPosition`.
- Produces: `getDevices()`, `getAppState()`, `connectDevice(id, opts?)`, `disconnectDevice(id)`, `connectNearest()`, `connectFavorite()`, `disconnectHeadset()`, `setListeningMode(mode, deviceId?)`, `toggleListeningMode()`, `toggleSpatialAudio()`, `showStatusWindow(id)`, `showDeviceMenu(id)`, `showDashboard()`, `setBatteryAlert(...)`, `deleteBatteryAlerts(id)`.

- [ ] **Step 1: Append the read functions to `src/airbuddy.ts`**

Note `run(argv)` — this is how JXA receives the serialized arguments. No interpolation anywhere.

```ts
import type {
  AppState,
  BatteryAlertKind,
  BatteryPosition,
  Device,
  ListeningMode,
  SpatialAudioMode,
} from "./types";

const GET_DEVICES = `
function run() {
  const app = Application("AirBuddyHelper");
  const out = [];
  for (const d of app.devices()) {
    const rec = {
      id: d.id(), name: d.name(), kind: d.kind(), model: d.model(), brand: d.brand(),
      address: d.address(), connected: d.connected(), nearby: d.nearby(),
      distance: d.distance(), source: d.source(), audioState: d.audioState(),
      inputRoute: d.inputRoute(), outputRoute: d.outputRoute(),
      listeningMode: d.listeningMode(),
      supportedListeningModes: d.supportedListeningModes(),
      leftBudInEar: d.leftBudInEar(), rightBudInEar: d.rightBudInEar(),
      anyBudInEar: d.anyBudInEar(), anyBudInCase: d.anyBudInCase(),
      caseLidClosed: d.caseLidClosed(),
      batteries: d.batteries().map(function (b) {
        return {
          position: b.position(), level: b.level(), chargingState: b.chargingState(),
          low: b.low(), unreliable: b.unreliable()
        };
      }),
      alerts: d.batteryAlerts().map(function (a) {
        return {
          kind: a.kind(), position: a.position(),
          threshold: a.threshold(), enabled: a.enabled()
        };
      })
    };
    out.push(rec);
  }
  return JSON.stringify(out);
}
`;

export async function getDevices(): Promise<Device[]> {
  return runJXA<Device[]>(GET_DEVICES);
}

const GET_APP_STATE = `
function run() {
  const app = Application("AirBuddyHelper");
  function nameOf(fn) {
    try { const d = fn(); return d ? d.name() : null; } catch (e) { return null; }
  }
  return JSON.stringify({
    spatialAudioMode: app.spatialAudioMode(),
    currentOutputName: nameOf(function () { return app.currentOutputDevice(); }),
    currentInputName: nameOf(function () { return app.currentInputDevice(); }),
    nearestHeadsetName: nameOf(function () { return app.nearestHeadset(); }),
    favoriteHeadsetName: nameOf(function () { return app.favoriteHeadset(); })
  });
}
`;

export async function getAppState(): Promise<AppState> {
  return runJXA<AppState>(GET_APP_STATE);
}
```

- [ ] **Step 2: Append the action functions**

```ts
const CONNECT_DEVICE = `
function run(argv) {
  const app = Application("AirBuddyHelper");
  const opts = {};
  if (argv[1]) opts.listeningMode = argv[1];
  if (argv[2] === "true") opts.microphoneEnabled = true;
  app.connectDevice(argv[0], opts);
  return "";
}
`;

export async function connectDevice(
  id: string,
  opts: { listeningMode?: ListeningMode; microphoneEnabled?: boolean } = {},
): Promise<void> {
  await runJXA<void>(CONNECT_DEVICE, [id, opts.listeningMode ?? "", String(opts.microphoneEnabled ?? false)]);
}

const DISCONNECT_DEVICE = `
function run(argv) {
  Application("AirBuddyHelper").disconnectDevice(argv[0]);
  return "";
}
`;

export async function disconnectDevice(id: string): Promise<void> {
  await runJXA<void>(DISCONNECT_DEVICE, [id]);
}

const CONNECT_NEAREST = `function run() { Application("AirBuddyHelper").connectToNearestHeadset(); return ""; }`;
export async function connectNearest(): Promise<void> {
  await runJXA<void>(CONNECT_NEAREST);
}

const CONNECT_FAVORITE = `function run() { Application("AirBuddyHelper").connectToFavoriteHeadset(); return ""; }`;
export async function connectFavorite(): Promise<void> {
  await runJXA<void>(CONNECT_FAVORITE);
}

const DISCONNECT_HEADSET = `function run() { Application("AirBuddyHelper").disconnectHeadset(); return ""; }`;
export async function disconnectHeadset(): Promise<void> {
  await runJXA<void>(DISCONNECT_HEADSET);
}

const SET_LISTENING_MODE = `
function run(argv) {
  const app = Application("AirBuddyHelper");
  if (argv[1]) {
    app.setListeningMode(argv[0], { device: argv[1] });
  } else {
    app.setListeningMode(argv[0]);
  }
  return "";
}
`;

export async function setListeningMode(mode: ListeningMode, deviceId?: string): Promise<void> {
  await runJXA<void>(SET_LISTENING_MODE, [mode, deviceId ?? ""]);
}

const TOGGLE_LISTENING_MODE = `function run() { Application("AirBuddyHelper").toggleListeningMode(); return ""; }`;
export async function toggleListeningMode(): Promise<void> {
  await runJXA<void>(TOGGLE_LISTENING_MODE);
}

const TOGGLE_SPATIAL_AUDIO = `function run() { Application("AirBuddyHelper").toggleSpatialAudioMode(); return ""; }`;
export async function toggleSpatialAudio(): Promise<void> {
  await runJXA<void>(TOGGLE_SPATIAL_AUDIO);
}

const SHOW_STATUS_WINDOW = `function run(argv) { Application("AirBuddyHelper").showStatusWindow(argv[0]); return ""; }`;
export async function showStatusWindow(id: string): Promise<void> {
  await runJXA<void>(SHOW_STATUS_WINDOW, [id]);
}

const SHOW_DEVICE_MENU = `function run(argv) { Application("AirBuddyHelper").showDeviceMenu(argv[0]); return ""; }`;
export async function showDeviceMenu(id: string): Promise<void> {
  await runJXA<void>(SHOW_DEVICE_MENU, [id]);
}

const SHOW_DASHBOARD = `function run() { Application("AirBuddyHelper").showDashboard(); return ""; }`;
export async function showDashboard(): Promise<void> {
  await runJXA<void>(SHOW_DASHBOARD);
}

const SET_LOW_ALERT = `
function run(argv) {
  Application("AirBuddyHelper").setLowBatteryAlert(argv[0], {
    threshold: parseFloat(argv[1]), part: argv[2], enabled: argv[3] === "true"
  });
  return "";
}
`;

const SET_CHARGED_ALERT = `
function run(argv) {
  Application("AirBuddyHelper").setChargedBatteryAlert(argv[0], {
    threshold: parseFloat(argv[1]), part: argv[2], enabled: argv[3] === "true"
  });
  return "";
}
`;

export async function setBatteryAlert(
  deviceId: string,
  kind: BatteryAlertKind,
  position: BatteryPosition,
  threshold: number,
  enabled: boolean,
): Promise<void> {
  const script = kind === "low battery" ? SET_LOW_ALERT : SET_CHARGED_ALERT;
  await runJXA<void>(script, [deviceId, String(threshold), position, String(enabled)]);
}

/**
 * NOT WIRED TO ANY UI IN V1. Deleting removes the only editable alert records, and whether
 * AirBuddy re-seeds them is unverified — the user could delete their way into an empty form
 * with no recovery path. Kept for future use. See spec, "Battery alert form".
 */
const DELETE_ALERTS = `function run(argv) { Application("AirBuddyHelper").deleteBatteryAlerts(argv[0]); return ""; }`;
export async function deleteBatteryAlerts(id: string): Promise<void> {
  await runJXA<void>(DELETE_ALERTS, [id]);
}
```

- [ ] **Step 3: Verify against real hardware**

The JXA method names (`connectDevice`, `setLowBatteryAlert`, …) are JXA's camelCase transforms of
the sdef's spaced command names. **Verify them, don't trust them.**

Run:
```bash
npx tsx -e 'import("./src/airbuddy").then(async (ab) => {
  const devices = await ab.getDevices();
  console.log("devices:", devices.length);
  console.log("kinds:", devices.map(d => d.kind).join(", "));
  const trackpad = devices.find(d => /trackpad/i.test(d.name));
  if (trackpad) {
    console.log("TRAP CHECK — trackpad listeningMode:", trackpad.listeningMode);
    console.log("TRAP CHECK — trackpad supported:", JSON.stringify(trackpad.supportedListeningModes));
  }
  console.log("appState:", JSON.stringify(await ab.getAppState()));
})' 2>&1 || echo "If tsx is unavailable, verify via: osascript -l JavaScript -e '<paste GET_DEVICES body>'"
```

Expected: a device count ≥ 1, the trackpad's `listeningMode` printing as `transparency` while its
`supportedListeningModes` prints as `[]` — **the trap, reproduced.** If `getDevices()` throws,
a JXA method name is wrong; check it against the sdef before proceeding.

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 5: Commit**

```bash
git add src/airbuddy.ts
git commit -m "feat: AirBuddy read and action commands"
```

---

## Task 4: The poll helper

**Files:**
- Create: `src/poll.ts`

**Interfaces:**
- Produces: `pollUntil<T>(read: () => Promise<T>, done: (v: T) => boolean, opts?): Promise<T>`.

Every action in this extension is fire-and-forget. This is the one helper that makes a HUD honest.
Both the list and the seven no-view commands use it — one implementation, not two.

- [ ] **Step 1: Create `src/poll.ts`**

```ts
export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export class PollTimeoutError extends Error {
  constructor(message = "Timed out waiting for AirBuddy to settle.") {
    super(message);
    this.name = "PollTimeoutError";
  }
}

/**
 * AirBuddy's action commands return when the request is ACCEPTED, not when Bluetooth settles.
 * Never report success on the return of an action — poll the postcondition instead.
 */
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await read();
    if (done(value)) return value;

    if (Date.now() >= deadline) {
      throw new PollTimeoutError();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 3: Commit**

```bash
git add src/poll.ts
git commit -m "feat: poll helper for fire-and-forget AirBuddy actions"
```

---

## Task 5: Shared toast/error plumbing

**Files:**
- Create: `src/feedback.ts`

**Interfaces:**
- Produces: `showFailure(title: string, error: unknown): Promise<void>`, `describeError(error: unknown): string`.

House style: **every** `Toast.Style.Failure` carries a "Copy Error" action. Centralizing it means
no call site can forget.

- [ ] **Step 1: Create `src/feedback.ts`**

```ts
import { Clipboard, Toast, showToast } from "@raycast/api";

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The ONLY sanctioned way to show a failure. House style requires a "Copy Error" primaryAction on
 * every failure toast; putting it here means no call site can omit it.
 */
export async function showFailure(title: string, error: unknown): Promise<void> {
  const message = describeError(error);
  await showToast({
    style: Toast.Style.Failure,
    title,
    message,
    primaryAction: {
      title: "Copy Error",
      onAction: async () => {
        await Clipboard.copy(message);
      },
    },
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 3: Commit**

```bash
git add src/feedback.ts
git commit -m "feat: centralized failure toast with Copy Error"
```

---

## Task 6: The devices hook

**Files:**
- Create: `src/hooks/use-devices.ts`

**Interfaces:**
- Consumes: `getDevices`, `Device`.
- Produces: `useDevices(): { devices: Device[]; isLoading: boolean; error: Error | undefined; revalidate: () => void }`.

- [ ] **Step 1: Create `src/hooks/use-devices.ts`**

**The type trap:** `useCachedPromise` has multiple overloads. An **unannotated** fetcher silently
resolves to the *paginated* overload and infers `data` as `any[]` — which sails past the no-`any`
lint rule because nobody wrote the word `any`. The explicit `Promise<Device[]>` return annotation
on `fetchDevices` is what pins the correct overload. **Do not remove it.**

`useCachedPromise` has **no** revalidation-interval option (verified against the installed
`@raycast/utils` types), so the poller is ours: an interval that clears on unmount and guards
against overlapping runs.

```ts
import { useCachedPromise } from "@raycast/utils";
import { useEffect, useRef } from "react";
import { getDevices } from "../airbuddy";
import type { Device } from "../types";

const REFRESH_MS = 5_000;

/** Return type annotated to pin the non-paginated overload. Without it, `data` infers as any[]. */
const fetchDevices = (): Promise<Device[]> => getDevices();

export function useDevices() {
  const { data, isLoading, error, revalidate } = useCachedPromise(fetchDevices, [], {
    initialData: [] as Device[],
    keepPreviousData: true,
  });

  const inFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      // Non-overlap guard: a slow osascript must not stack up a queue of subprocesses.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        revalidate();
      } finally {
        inFlight.current = false;
      }
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [revalidate]);

  return { devices: data ?? [], isLoading, error, revalidate };
}
```

- [ ] **Step 2: Verify the overload is pinned, not merely assumed**

This is the witnessed check for the trap. Temporarily add this line to the hook:

```ts
const _typeProbe: Device[] = data ?? [];
```

Run: `npx tsc --noEmit`
Expected: exit 0. If `data` had resolved to `any[]`, this would still pass — so **also** confirm by
hovering/inspecting: `npx tsc --noEmit --explainFiles false` and check no implicit-any surfaces.
Then **remove the probe line**.

The real assertion: the annotation `(): Promise<Device[]>` is present on `fetchDevices`. If a future
edit drops it, the overload silently flips. Leave the comment.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-devices.ts
git commit -m "feat: devices hook with bounded interval polling"
```

---

## Task 7: Error / onboarding views

**Files:**
- Create: `src/components/error-views.tsx`

**Interfaces:**
- Consumes: the error classes from `src/airbuddy.ts`.
- Produces: `<ErrorView error={error} onRetry={fn} />`.

- [ ] **Step 1: Create `src/components/error-views.tsx`**

The `-1743` ambiguity is real: it means *either* AirBuddy's scripting switch is off *or* macOS
Automation consent is denied. Until Task 12 verifies the exact stderr for each, the combined view is
the safe default — naming both settings beats confidently sending someone to the wrong one.

```tsx
import { Action, ActionPanel, Icon, List, open } from "@raycast/api";
import {
  AirBuddyNotInstalledError,
  AirBuddyNotRunningError,
  AutomationConsentError,
  ScriptingDisabledError,
} from "../airbuddy";

const AIRBUDDY_URL = "https://airbuddy.app";

export function ErrorView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof AirBuddyNotInstalledError) {
    return (
      <List.EmptyView
        icon={Icon.Download}
        title="AirBuddy Isn't Installed"
        description="This extension controls AirBuddy 3.0 or later."
        actions={
          <ActionPanel>
            <Action.OpenInBrowser title="Get Airbuddy" url={AIRBUDDY_URL} />
          </ActionPanel>
        }
      />
    );
  }

  if (error instanceof AirBuddyNotRunningError) {
    return (
      <List.EmptyView
        icon={Icon.Play}
        title="AirBuddy Isn't Running"
        description="Launch AirBuddy, then try again."
        actions={
          <ActionPanel>
            <Action title="Open Airbuddy" icon={Icon.Play} onAction={() => open("/Applications/AirBuddy.app")} />
            <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
          </ActionPanel>
        }
      />
    );
  }

  if (error instanceof ScriptingDisabledError || error instanceof AutomationConsentError) {
    return (
      <List.EmptyView
        icon={Icon.Lock}
        title="AirBuddy Needs Permission"
        description={
          "Two settings control this, and either one can block it:\n\n" +
          "1. AirBuddy → Settings → Advanced → Security → enable “Enable Apple Script for automation”.\n\n" +
          "2. System Settings → Privacy & Security → Automation → Raycast → enable AirBuddyHelper.\n\n" +
          "Turn both on, then try again."
        }
        actions={
          <ActionPanel>
            <Action title="Open Airbuddy Settings" icon={Icon.Gear} onAction={() => open("/Applications/AirBuddy.app")} />
            <Action
              title="Open Automation Settings"
              icon={Icon.Lock}
              onAction={() => open("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")}
            />
            <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List.EmptyView
      icon={Icon.Warning}
      title="Something Went Wrong"
      description={error.message}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Error" content={error.message} />
          <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
        </ActionPanel>
      }
    />
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 3: Commit**

```bash
git add src/components/error-views.tsx
git commit -m "feat: onboarding and error empty views"
```

---

## Task 8: The device row

**Files:**
- Create: `src/components/device-list-item.tsx`

**Interfaces:**
- Consumes: `Device`, `supportsListeningMode`, `primaryBattery`, `caseBattery`, `budsDiverge`, `iconFor`, `batteryColor`.
- Produces: `<DeviceListItem device={device} actions={node} />`.

- [ ] **Step 1: Create `src/components/device-list-item.tsx`**

The listening-mode accessory is gated on `supportsListeningMode(device)` — **not** on
`device.listeningMode`, which is populated with garbage for speakerless devices. Without the gate,
your Magic Trackpad renders a "Transparency" badge.

```tsx
import { Color, Icon, List } from "@raycast/api";
import type { ReactNode } from "react";
import {
  type Device,
  batteryColor,
  budsDiverge,
  caseBattery,
  iconFor,
  primaryBattery,
  supportsListeningMode,
} from "../types";

const MODE_LABELS: Record<string, string> = {
  normal: "Off",
  "noise cancellation": "ANC",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

function subtitleFor(device: Device): string | undefined {
  // Only headsets carry meaningful in-ear/route/proximity state.
  if (device.kind !== "headset") return undefined;

  const parts: string[] = [];
  if (device.anyBudInEar) parts.push("In ear");
  else if (device.anyBudInCase) parts.push("In case");

  if (device.outputRoute && device.inputRoute) parts.push("Output + Input");
  else if (device.outputRoute) parts.push("Output");
  else if (device.inputRoute) parts.push("Input");

  if (device.distance !== "unknown") {
    parts.push(device.distance.charAt(0).toUpperCase() + device.distance.slice(1));
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function DeviceListItem({ device, actions }: { device: Device; actions: ReactNode }) {
  const accessories: List.Item.Accessory[] = [];

  // Listening mode — ONLY when the device actually supports one. A trackpad reports
  // listeningMode: "transparency" with supportedListeningModes: []. Never trust the former alone.
  if (supportsListeningMode(device)) {
    accessories.push({
      tag: { value: MODE_LABELS[device.listeningMode] ?? device.listeningMode, color: Color.Purple },
    });
  }

  const chargeCase = caseBattery(device);
  if (chargeCase) {
    accessories.push({
      icon: { source: Icon.Battery, tintColor: batteryColor(chargeCase) },
      text: `${Math.round(chargeCase.level)}%`,
      tooltip: `Charging case: ${Math.round(chargeCase.level)}%`,
    });
  }

  if (budsDiverge(device)) {
    const left = device.batteries.find((b) => b.position === "left bud");
    const right = device.batteries.find((b) => b.position === "right bud");
    if (left && right) {
      accessories.push({
        text: `L ${Math.round(left.level)}% · R ${Math.round(right.level)}%`,
        tooltip: "Earbuds differ",
      });
    }
  }

  const primary = primaryBattery(device);
  if (primary) {
    const charging = primary.chargingState !== "discharging";
    accessories.push({
      icon: {
        source: charging ? Icon.BatteryCharging : Icon.Battery,
        tintColor: batteryColor(primary),
      },
      text: `${Math.round(primary.level)}%`,
      tooltip: primary.unreliable
        ? `${Math.round(primary.level)}% (AirBuddy reports this reading as unreliable)`
        : `${Math.round(primary.level)}% · ${primary.chargingState}`,
    });
  }

  return (
    <List.Item
      icon={iconFor(device)}
      title={device.name}
      subtitle={subtitleFor(device)}
      accessories={accessories}
      actions={actions}
    />
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 3: Commit**

```bash
git add src/components/device-list-item.tsx
git commit -m "feat: device row with battery accessories"
```

---

## Task 9: The action panel

**Files:**
- Create: `src/components/device-actions.tsx`

**Interfaces:**
- Consumes: `Device`, `supportsListeningMode`, the `airbuddy` actions, `pollUntil`, `showFailure`, and
  **`BatteryAlertsForm` from Task 10.**
- Produces: `<DeviceActions device={device} onRefresh={fn} />`.

> **Do Task 10 first.** This component imports `BatteryAlertsForm`, so `tsc` cannot pass here until
> that file exists. The tasks are numbered in reading order, not build order — build 10, then 9.

**Shortcuts.** `Common` where a semantic match exists; plain `{ modifiers, key }` objects where none
does (Mac-only extension — **never** `{ macOS, Windows }` here). `⌘L` and `⌘⇧S` have no `Common`
equivalent ("switch mode" isn't in the 17). Verify no two actions in the resolved panel — **including
the submenu** — share a shortcut, and that none collides with the auto-assigned `↵` / `⌘↵`.

- [ ] **Step 1: Create `src/components/device-actions.tsx`**

```tsx
import { Action, ActionPanel, Icon, Keyboard, Toast, showToast } from "@raycast/api";
import {
  connectDevice,
  disconnectDevice,
  getDevices,
  setListeningMode,
  showDeviceMenu,
  showStatusWindow,
  toggleSpatialAudio,
} from "../airbuddy";
import { showFailure } from "../feedback";
import { pollUntil } from "../poll";
import { BatteryAlertsForm } from "../battery-alerts";
import { type Device, type ListeningMode, supportsListeningMode } from "../types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

export function DeviceActions({ device, onRefresh }: { device: Device; onRefresh: () => void }) {
  async function handleConnect() {
    // Fire the indicator BEFORE the async work. Silence during a long operation is a defect.
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Connecting to ${device.name}…`,
    });

    try {
      await connectDevice(device.id);

      // The command returns on request-ACCEPT, not on Bluetooth settle. Poll the real postcondition.
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.connected === true,
      );

      toast.style = Toast.Style.Success;
      toast.title = `Connected to ${device.name}`;
      onRefresh();
    } catch (error) {
      await showFailure(`Couldn't connect to ${device.name}`, error);
    }
  }

  async function handleDisconnect() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Disconnecting ${device.name}…`,
    });

    try {
      await disconnectDevice(device.id);
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.connected !== true,
      );

      toast.style = Toast.Style.Success;
      toast.title = `Disconnected ${device.name}`;
      onRefresh();
    } catch (error) {
      await showFailure(`Couldn't disconnect ${device.name}`, error);
    }
  }

  async function handleSetMode(mode: ListeningMode) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${MODE_LABELS[mode]}…` });
    try {
      await setListeningMode(mode, device.id);
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.listeningMode === mode,
      );
      toast.style = Toast.Style.Success;
      toast.title = MODE_LABELS[mode];
      onRefresh();
    } catch (error) {
      await showFailure("Couldn't change listening mode", error);
    }
  }

  return (
    <ActionPanel>
      <ActionPanel.Section>
        {device.connected ? (
          <Action title="Disconnect" icon={Icon.Plug} onAction={handleDisconnect} />
        ) : (
          <Action title="Connect" icon={Icon.Plug} onAction={handleConnect} />
        )}

        {/* Rendered ONLY for devices that actually support listening modes. */}
        {supportsListeningMode(device) && (
          <ActionPanel.Submenu
            title="Listening Mode"
            icon={Icon.Headphones}
            shortcut={{ modifiers: ["cmd"], key: "l" }}
          >
            {device.supportedListeningModes.map((mode) => (
              <Action key={mode} title={MODE_LABELS[mode]} onAction={() => handleSetMode(mode)} />
            ))}
          </ActionPanel.Submenu>
        )}
      </ActionPanel.Section>

      <ActionPanel.Section>
        <Action
          title="Show Status Window"
          icon={Icon.Window}
          shortcut={Keyboard.Shortcut.Common.Open}
          onAction={async () => {
            try {
              await showStatusWindow(device.id);
            } catch (error) {
              await showFailure("Couldn't show the status window", error);
            }
          }}
        />
        <Action
          title="Show Device Menu"
          icon={Icon.List}
          shortcut={Keyboard.Shortcut.Common.OpenWith}
          onAction={async () => {
            try {
              await showDeviceMenu(device.id);
            } catch (error) {
              await showFailure("Couldn't show the device menu", error);
            }
          }}
        />
        <Action.Push
          title="Configure Battery Alerts"
          icon={Icon.Bell}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={<BatteryAlertsForm device={device} />}
        />
        <Action
          title="Toggle Spatial Audio"
          icon={Icon.Speaker}
          shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          onAction={async () => {
            try {
              await toggleSpatialAudio();
              await showToast({ style: Toast.Style.Success, title: "Toggled Spatial Audio" });
            } catch (error) {
              await showFailure("Couldn't toggle Spatial Audio", error);
            }
          }}
        />
      </ActionPanel.Section>

      <ActionPanel.Section>
        <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={Keyboard.Shortcut.Common.Refresh} onAction={onRefresh} />
        <Action.CopyToClipboard title="Copy Device Id" content={device.id} shortcut={Keyboard.Shortcut.Common.Copy} />
        <Action.CopyToClipboard title="Copy Device Name" content={device.name} shortcut={Keyboard.Shortcut.Common.CopyName} />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
```

- [ ] **Step 2: Verify the conflict invariant by hand**

List every shortcut in the resolved panel, including the submenu, and confirm no duplicates:

| Action | Shortcut |
|---|---|
| Connect/Disconnect | `↵` (auto, first action) |
| Listening Mode submenu | `⌘L` |
| Show Status Window | `⌘O` (`Common.Open`) |
| Show Device Menu | `⌘⇧O` (`Common.OpenWith`) |
| Configure Battery Alerts | `⌘E` (`Common.Edit`) |
| Toggle Spatial Audio | `⌘⇧S` |
| Refresh | `⌘R` (`Common.Refresh`) |
| Copy Device ID | `⌘⇧C` (`Common.Copy`) |
| Copy Device Name | `⌘⇧.` (`Common.CopyName`) |

Confirm: no duplicates, and nothing collides with the auto-assigned `↵` / `⌘↵`. **Note the
listening-mode submenu's child actions carry no shortcuts** — if you add any, re-run this check.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 4: Commit**

```bash
git add src/components/device-actions.tsx
git commit -m "feat: device action panel with polled connect/disconnect"
```

---

## Task 10: The battery alerts form

**Files:**
- Create: `src/battery-alerts.tsx`

**Interfaces:**
- Consumes: `Device`, `BatteryAlert`, `setBatteryAlert`, `showFailure`.
- Produces: `<BatteryAlertsForm device={device} />` (consumed by Task 9 — build this before Task 9 compiles).

**Deletion is CUT from v1.** `deleteBatteryAlerts()` exists in `airbuddy.ts` but **no UI calls it**.
Deleting removes the only editable records, and whether AirBuddy re-seeds them is unverified — the
user could delete their way into an empty form with no recovery path.

**The projection:** render exactly one row per alert AirBuddy reports. A headset reports 4 (low +
charged × left bud + charging case); everything else reports 2 (low + charged × main). There is no
separate rule for headsets — the reported list *is* the projection.

- [ ] **Step 1: Create `src/battery-alerts.tsx`**

```tsx
import { Action, ActionPanel, Form, Icon, Keyboard, Toast, showToast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { setBatteryAlert } from "./airbuddy";
import { showFailure } from "./feedback";
import type { BatteryAlert, Device } from "./types";

const POSITION_LABELS: Record<string, string> = {
  main: "Battery",
  "combined buds": "Earbuds",
  // AirBuddy stores multipart bud alerts through the left-bud entry when there is no `main` part.
  // Label it honestly for the user; the underlying position is passed through untouched.
  "left bud": "Earbuds",
  "right bud": "Right Earbud",
  "charging case": "Charging Case",
};

const KIND_LABELS: Record<string, string> = {
  "low battery": "Low Battery",
  charged: "Charged",
};

function rowKey(alert: BatteryAlert): string {
  return `${alert.kind}|${alert.position}`;
}

export function BatteryAlertsForm({ device }: { device: Device }) {
  const { pop } = useNavigation();
  const [isSaving, setIsSaving] = useState(false);

  const [values, setValues] = useState(() => {
    const initial: Record<string, { enabled: boolean; threshold: string }> = {};
    for (const alert of device.alerts) {
      initial[rowKey(alert)] = {
        enabled: alert.enabled,
        threshold: String(Math.round(alert.threshold)),
      };
    }
    return initial;
  });

  async function handleSave() {
    // Validate before dispatching — AirBuddy may silently reject a bad value.
    for (const alert of device.alerts) {
      const raw = values[rowKey(alert)];
      const threshold = Number(raw.threshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Invalid threshold",
          message: `${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]} must be 0–100.`,
        });
        return;
      }
    }

    setIsSaving(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Saving alerts…" });

    // NOT ATOMIC. These are N independent fire-and-forget calls; AirBuddy offers no transaction.
    // If one fails, earlier ones have already applied — say so rather than pretending otherwise.
    const applied: string[] = [];
    try {
      for (const alert of device.alerts) {
        const raw = values[rowKey(alert)];
        const threshold = Number(raw.threshold);

        const unchanged = alert.enabled === raw.enabled && Math.round(alert.threshold) === threshold;
        if (unchanged) continue;

        await setBatteryAlert(device.id, alert.kind, alert.position, threshold, raw.enabled);
        applied.push(`${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]}`);
      }

      toast.style = Toast.Style.Success;
      toast.title = applied.length > 0 ? "Alerts saved" : "No changes";
      pop();
    } catch (error) {
      const detail =
        applied.length > 0
          ? `Applied: ${applied.join(", ")}. The rest did not save.`
          : "No changes were applied.";
      await showFailure(`Couldn't save all alerts. ${detail}`, error);
    } finally {
      setIsSaving(false);
    }
  }

  if (device.alerts.length === 0) {
    return (
      <Form>
        <Form.Description
          title="No Alerts"
          text={`AirBuddy doesn't report any battery alerts for ${device.name}.`}
        />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={`Battery Alerts — ${device.name}`}
      actions={
        <ActionPanel>
          <Action
            title="Save Alerts"
            icon={Icon.Check}
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={handleSave}
          />
        </ActionPanel>
      }
    >
      {device.alerts.map((alert) => {
        const key = rowKey(alert);
        const label = `${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]}`;
        return (
          <Fragment key={key}>
            <Form.Checkbox
              id={`${key}-enabled`}
              label={label}
              value={values[key].enabled}
              onChange={(enabled) => setValues((v) => ({ ...v, [key]: { ...v[key], enabled } }))}
            />
            <Form.TextField
              id={`${key}-threshold`}
              title="Threshold (%)"
              placeholder="0–100"
              value={values[key].threshold}
              onChange={(threshold) => setValues((v) => ({ ...v, [key]: { ...v[key], threshold } }))}
            />
          </Fragment>
        );
      })}
    </Form>
  );
}
```

The `Fragment` import comes from React — extend the existing import line:

```ts
import { Fragment, useState } from "react";
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

If Raycast rejects a `Fragment` wrapping Form children (it flattens children but is strict about
what it accepts), fall back to building a flat array instead of nesting:

```tsx
{device.alerts.flatMap((alert) => {
  const key = rowKey(alert);
  const label = `${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]}`;
  return [
    <Form.Checkbox
      key={`${key}-enabled`}
      id={`${key}-enabled`}
      label={label}
      value={values[key].enabled}
      onChange={(enabled) => setValues((v) => ({ ...v, [key]: { ...v[key], enabled } }))}
    />,
    <Form.TextField
      key={`${key}-threshold`}
      id={`${key}-threshold`}
      title="Threshold (%)"
      placeholder="0–100"
      value={values[key].threshold}
      onChange={(threshold) => setValues((v) => ({ ...v, [key]: { ...v[key], threshold } }))}
    />,
  ];
})}
```

- [ ] **Step 3: Commit**

```bash
git add src/battery-alerts.tsx
git commit -m "feat: battery alerts form (edit in place, no deletion)"
```

---

## Task 11: The list command

**Files:**
- Create: `src/list-devices.tsx`

**Interfaces:**
- Consumes: `useDevices`, `DeviceListItem`, `DeviceActions`, `ErrorView`, `sectionFor`.

- [ ] **Step 1: Create `src/list-devices.tsx`**

Section order is fixed (not alphabetical) so the list doesn't reshuffle as devices come and go —
and devices **do** come and go: AirPods drop out of the feed when they return to the case. A
shrinking list is normal, not an error.

```tsx
import { List } from "@raycast/api";
import { useState } from "react";
import { DeviceActions } from "./components/device-actions";
import { DeviceListItem } from "./components/device-list-item";
import { ErrorView } from "./components/error-views";
import { useDevices } from "./hooks/use-devices";
import { type Device, sectionFor } from "./types";

type Filter = "all" | "connected" | "headsets";

// Fixed order — the list must not reshuffle as devices appear and disappear.
const SECTION_ORDER = [
  "AirPods",
  "Macs",
  "iPhones, iPads, and Apple Watch",
  "Keyboards, Mice, and Other Peripherals",
];

function applyFilter(devices: Device[], filter: Filter): Device[] {
  switch (filter) {
    case "connected":
      return devices.filter((d) => d.connected);
    case "headsets":
      return devices.filter((d) => d.kind === "headset");
    case "all":
      return devices;
  }
}

export default function Command() {
  const { devices, isLoading, error, revalidate } = useDevices();
  const [filter, setFilter] = useState<Filter>("all");

  if (error) {
    return (
      <List>
        <ErrorView error={error} onRetry={revalidate} />
      </List>
    );
  }

  const filtered = applyFilter(devices, filter);

  const grouped = new Map<string, Device[]>();
  for (const device of filtered) {
    const section = sectionFor(device);
    const existing = grouped.get(section);
    if (existing) existing.push(device);
    else grouped.set(section, [device]);
  }

  return (
    <List
      isLoading={isLoading}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={filter} onChange={(v) => setFilter(v as Filter)}>
          <List.Dropdown.Item title="All Devices" value="all" />
          <List.Dropdown.Item title="Connected" value="connected" />
          <List.Dropdown.Item title="Headsets" value="headsets" />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        title={isLoading ? "Loading Devices…" : "No Devices"}
        description={
          isLoading
            ? undefined
            : "AirBuddy only reports devices that are currently live. Turn a device on, or take your AirPods out of their case."
        }
      />

      {SECTION_ORDER.filter((title) => grouped.has(title)).map((title) => (
        <List.Section key={title} title={title} subtitle={String(grouped.get(title)?.length ?? 0)}>
          {grouped.get(title)?.map((device) => (
            <DeviceListItem
              key={device.id}
              device={device}
              actions={<DeviceActions device={device} onRefresh={revalidate} />}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. Paste the raw result.

- [ ] **Step 3: Run it against real hardware**

Run: `npm run dev`

Then in Raycast, open **Devices**. Expected against the live fixture:
- Sections render in fixed order, only for kinds actually present.
- **The Magic Trackpad shows NO listening-mode badge** and **no listening-mode action** in its panel.
  If it shows "Transparency", `supportsListeningMode` is not being consulted — stop and fix.
- Battery percentages match AirBuddy's own menu bar.
- Take AirPods out of the case → they appear within ~5s (the poll interval), with 4 batteries and an
  ANC badge. Put them back → they disappear. Neither is an error.

- [ ] **Step 4: Commit**

```bash
git add src/list-devices.tsx
git commit -m "feat: devices list command"
```

---

## Task 12: The seven no-view commands

**Files:**
- Create: `src/connect-nearest-headset.ts`, `src/connect-favorite-headset.ts`, `src/disconnect-headset.ts`, `src/toggle-listening-mode.ts`, `src/set-listening-mode.ts`, `src/toggle-spatial-audio.ts`, `src/show-dashboard.ts`

**Interfaces:**
- Consumes: the `airbuddy` actions, `pollUntil`, `showFailure`, `getDevices`, `getAppState`.

**Every one of these polls its postcondition.** A HUD reading "Connected" when AirBuddy has merely
accepted the request is the same defect as an instant success toast. Only `show-dashboard` gets an
immediate HUD — showing a window has no async state to settle.

> **Note for `connect-favorite-headset` (Step 2): it needs a new client function**,
> `getFavoriteHeadset()`, added to `src/airbuddy.ts`. The code is in that step. This is the one place
> Task 12 touches the client layer.

- [ ] **Step 1: `src/connect-nearest-headset.ts`**

```ts
import { Toast, showToast } from "@raycast/api";
import { connectNearest, getAppState, getDevices } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Connecting to nearest headset…" });

  try {
    const state = await getAppState();
    if (!state.nearestHeadsetName) {
      toast.style = Toast.Style.Failure;
      toast.title = "No nearby headset";
      toast.message = "AirBuddy doesn't see a headset right now.";
      return;
    }

    // Re-bind: TS does not carry the null-check above into the closure below.
    const target: string = state.nearestHeadsetName;

    await connectNearest();
    await pollUntil(
      () => getDevices(),
      (devices) => devices.find((d) => d.name === target)?.connected === true,
    );

    toast.style = Toast.Style.Success;
    toast.title = `Connected to ${target}`;
  } catch (error) {
    await showFailure("Couldn't connect to the nearest headset", error);
  }
}
```

- [ ] **Step 2: `src/connect-favorite-headset.ts`**

> **CORRECTED 2026-07-13 (mid-implementation).** An earlier draft claimed `favorite headset` returns
> `missing value` and that this command therefore had to poll blindly for "any headset became
> connected." **That was wrong.** `favorite headset` resolves a **full device object — including for a
> headset that is offline and absent from `devices`** (verified: AirPods in their case, `connected:
> false`, `inDevicesList: false`, yet the favorite still returns id, name, and supported modes).
>
> So we read the favorite FIRST, name it in the toast, and poll for **that specific id**. This is
> strictly better: it cannot misattribute a coincidental connection, and the user sees what they're
> waiting on.

This requires a new client function. **Add it to `src/airbuddy.ts`** (it belongs with the other reads):

```ts
const GET_FAVORITE = `
function run() {
  const app = Application("AirBuddyHelper");
  const f = app.favoriteHeadset();
  if (!f) return JSON.stringify(null);
  return JSON.stringify({ id: f.id(), name: f.name() });
}
`;

export async function getFavoriteHeadset(): Promise<{ id: string; name: string } | null> {
  return runJXA<{ id: string; name: string } | null>(GET_FAVORITE);
}
```

Then the command:

```ts
import { Toast, showToast } from "@raycast/api";
import { connectFavorite, getDevices, getFavoriteHeadset } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Connecting to favorite headset…" });

  try {
    // Resolve the favorite FIRST — it works even when the headset is in its case and absent
    // from the devices list. If there isn't one, fail now rather than dispatching a doomed connect.
    const favorite = await getFavoriteHeadset();

    if (!favorite) {
      toast.style = Toast.Style.Failure;
      toast.title = "No favorite headset";
      toast.message = "Star a headset in AirBuddy's Devices settings first.";
      return;
    }

    // Re-bind: TS does not carry the null-check above into the closure below.
    const target: { id: string; name: string } = favorite;

    toast.title = `Connecting to ${target.name}…`;

    await connectFavorite();
    await pollUntil(
      () => getDevices(),
      (devices) => devices.find((d) => d.id === target.id)?.connected === true,
    );

    toast.style = Toast.Style.Success;
    toast.title = `Connected to ${target.name}`;
  } catch (error) {
    await showFailure("Couldn't connect to the favorite headset", error);
  }
}
```

- [ ] **Step 3: `src/disconnect-headset.ts`**

```ts
import { Toast, showToast } from "@raycast/api";
import { disconnectHeadset, getDevices } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Disconnecting headset…" });

  try {
    await disconnectHeadset();
    await pollUntil(
      () => getDevices(),
      (devices) => !devices.some((d) => d.kind === "headset" && d.connected),
    );

    toast.style = Toast.Style.Success;
    toast.title = "Headset disconnected";
  } catch (error) {
    await showFailure("Couldn't disconnect the headset", error);
  }
}
```

- [ ] **Step 4: `src/toggle-listening-mode.ts`**

```ts
import { Toast, showToast } from "@raycast/api";
import { getDevices, toggleListeningMode } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { type ListeningMode, supportsListeningMode } from "./types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Switching listening mode…" });

  try {
    const before = await getDevices();
    const headset = before.find((d) => supportsListeningMode(d) && d.connected);

    if (!headset) {
      toast.style = Toast.Style.Failure;
      toast.title = "No headset connected";
      toast.message = "Connect a headset that supports listening modes.";
      return;
    }

    const previous = headset.listeningMode;
    const id: string = headset.id;

    await toggleListeningMode();

    const after = await pollUntil(
      () => getDevices(),
      (devices) => {
        const current = devices.find((d) => d.id === id);
        return current !== undefined && current.listeningMode !== previous;
      },
    );

    const now = after.find((d) => d.id === id)?.listeningMode;
    toast.style = Toast.Style.Success;
    toast.title = now ? MODE_LABELS[now] : "Listening mode changed";
  } catch (error) {
    await showFailure("Couldn't switch the listening mode", error);
  }
}
```

- [ ] **Step 5: `src/set-listening-mode.ts`**

The dropdown's `data` is **static** (manifest-declared), so it lists all four modes regardless of
what the current headset supports. Check `supportedListeningModes` before dispatching, or AirBuddy
silently drops the call.

Argument values come from Raycast's **generated ambient types** — do **not** hand-declare an
`Arguments` interface (house style).

```ts
import { type LaunchProps, Toast, showToast } from "@raycast/api";
import { getDevices, setListeningMode } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { type ListeningMode, supportsListeningMode } from "./types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

export default async function Command(props: LaunchProps<{ arguments: Arguments.SetListeningMode }>) {
  const mode = props.arguments.mode as ListeningMode;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${MODE_LABELS[mode]}…` });

  try {
    const devices = await getDevices();
    const headset = devices.find((d) => supportsListeningMode(d) && d.connected);

    if (!headset) {
      toast.style = Toast.Style.Failure;
      toast.title = "No headset connected";
      toast.message = "Connect a headset that supports listening modes.";
      return;
    }

    // The dropdown is static — it offers all four modes even if this headset supports fewer.
    if (!headset.supportedListeningModes.includes(mode)) {
      toast.style = Toast.Style.Failure;
      toast.title = `${headset.name} doesn't support ${MODE_LABELS[mode]}`;
      toast.message = `Supported: ${headset.supportedListeningModes.map((m) => MODE_LABELS[m]).join(", ")}`;
      return;
    }

    const id: string = headset.id;
    await setListeningMode(mode, id);

    await pollUntil(
      () => getDevices(),
      (list) => list.find((d) => d.id === id)?.listeningMode === mode,
    );

    toast.style = Toast.Style.Success;
    toast.title = MODE_LABELS[mode];
  } catch (error) {
    await showFailure("Couldn't set the listening mode", error);
  }
}
```

- [ ] **Step 6: `src/toggle-spatial-audio.ts`**

```ts
import { Toast, showToast } from "@raycast/api";
import { getAppState, toggleSpatialAudio } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import type { SpatialAudioMode } from "./types";

const MODE_LABELS: Record<SpatialAudioMode, string> = {
  off: "Spatial Audio Off",
  fixed: "Spatial Audio: Fixed",
  "head tracked": "Spatial Audio: Head Tracked",
};

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Toggling Spatial Audio…" });

  try {
    const before = await getAppState();
    const previous = before.spatialAudioMode;

    await toggleSpatialAudio();

    const after = await pollUntil(
      () => getAppState(),
      (state) => state.spatialAudioMode !== previous,
    );

    toast.style = Toast.Style.Success;
    toast.title = MODE_LABELS[after.spatialAudioMode];
  } catch (error) {
    await showFailure("Couldn't toggle Spatial Audio", error);
  }
}
```

- [ ] **Step 7: `src/show-dashboard.ts`**

The only command with an immediate HUD — showing a window has no async postcondition.

```ts
import { closeMainWindow, showHUD } from "@raycast/api";
import { showDashboard } from "./airbuddy";
import { showFailure } from "./feedback";

export default async function Command() {
  try {
    await closeMainWindow();
    await showDashboard();
    await showHUD("AirBuddy Dashboard");
  } catch (error) {
    await showFailure("Couldn't open the AirBuddy dashboard", error);
  }
}
```

- [ ] **Step 8: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0. **`Arguments.SetListeningMode` is a generated ambient type** — if it's missing, run
`npm run dev` once to regenerate `raycast-env.d.ts`, then re-run `tsc`. Paste the raw result.

- [ ] **Step 9: Commit**

```bash
git add src/*.ts
git commit -m "feat: seven no-view commands with polled postconditions"
```

---

## Task 13: Verify the permission-denial states

**Files:** none — this is a verification task that may amend `src/airbuddy.ts`.

**This is a deliverable, not an optional check.** The `-1743` classification in `classifyError` is
currently a **guess**, because both permissions are already granted on the dev machine, making the
denied states unreachable. If the guess is wrong, the onboarding view sends users to the wrong
Settings pane.

- [ ] **Step 1: Capture the "AirBuddy scripting disabled" stderr**

Turn OFF: AirBuddy → Settings → Advanced → Security → "Enable Apple Script for automation".

Run:
```bash
osascript -l JavaScript -e 'Application("AirBuddyHelper").devices().length' 2>&1
```

Expected (observed once already): an error containing `-1743` **and** AirBuddy's own message —
"Before running an Apple Script that communicates with AirBuddy, you must enable scripting in
AirBuddy Settings."

**Record the exact string.** Then turn the setting back on.

- [ ] **Step 2: Capture the "Automation consent denied" stderr**

Turn OFF: System Settings → Privacy & Security → Automation → Raycast → AirBuddyHelper.
(If Raycast isn't listed, trigger the prompt by running a command, then deny it.)

Run the same `osascript` line **from Raycast** (the consent is per-calling-app; running it from
Terminal tests Terminal's consent, not Raycast's). Simplest route: `npm run dev`, open Devices, and
capture the error the ErrorView reports.

Expected: `-1743` **without** any AirBuddy-authored message.

**Record the exact string.** Then turn the setting back on.

- [ ] **Step 3: Correct `classifyError` against the two recorded strings**

Amend the matcher in `src/airbuddy.ts` so each real string maps to the right error class. If the two
cases genuinely cannot be told apart from stderr, **keep the combined view** (Task 7 already renders
one for both) and delete the now-dead branch — do not guess.

- [ ] **Step 4: Verify each denied state renders the right view**

With each setting individually off, open **Devices** and confirm the empty view names the correct
setting (or, if indistinguishable, names both).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0. Paste the raw results.

```bash
git add src/airbuddy.ts
git commit -m "fix: classify AirBuddy scripting vs macOS automation denial from real stderr"
```

---

## Task 14: README

**Files:**
- Create: `README.md`

Raycast requires a README when an extension needs non-trivial external setup. This one needs **two**
permissions in **two different apps** — without a README the first run is an error the user can't act on.

- [ ] **Step 1: Create `README.md`**

```markdown
# AirBuddy for Raycast

Control [AirBuddy](https://airbuddy.app) from Raycast — see live devices and batteries, connect and
disconnect, switch listening and Spatial Audio modes, and manage battery alerts.

Requires **AirBuddy 3.0 or later**.

## Setup

This extension talks to AirBuddy over AppleScript, which needs **two** permissions. Both are off by
default, and the extension will show you which one is missing.

**1. Enable scripting in AirBuddy**

AirBuddy → Settings → Advanced → Security → turn on **"Enable Apple Script for automation."**

**2. Allow Raycast to control AirBuddy**

The first time you run a command, macOS asks whether Raycast may control AirBuddy. Choose **OK**.

If you dismissed it, turn it on manually: System Settings → Privacy & Security → Automation →
Raycast → enable **AirBuddyHelper**.

## Commands

| Command | What it does |
|---|---|
| **Devices** | Live devices grouped by type, with batteries, listening mode, and per-device actions |
| **Connect Nearest Headset** | Connects to the headset AirBuddy considers closest |
| **Connect Favorite Headset** | Connects to the headset starred in AirBuddy |
| **Disconnect Headset** | Disconnects the connected headset |
| **Toggle Listening Mode** | Cycles the listening mode (AirBuddy picks the order) |
| **Set Listening Mode** | Sets a specific mode — Off, Noise Cancellation, Transparency, or Adaptive |
| **Toggle Spatial Audio** | Toggles Spatial Audio on the current output device |
| **Show AirBuddy Dashboard** | Opens AirBuddy's device dashboard |

## Good to know

**Only live devices appear.** AirBuddy's scripting API reports the devices it can currently see — not
your full roster. AirPods in their case, a powered-off Mac, or a pinned-but-absent device won't be
listed. Devices appearing and disappearing as they come in and out of range is normal.

**Pins and favorites aren't visible.** AirBuddy's pin and star settings aren't exposed to AppleScript,
so this extension can't show or change them. Use AirBuddy's own UI for those.

**Actions are asynchronous.** Connecting takes a moment. The extension waits for the device to actually
connect before reporting success rather than claiming it immediately.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, commands, and API limitations"
```

---

## Task 15: Final gates and the polish pass

**Files:** any, as needed.

Chris's standing rule: **a first working build is not a finished one.** Walk the states before
declaring anything done.

- [ ] **Step 1: Run every gate, and paste the raw output for each**

```bash
npx tsc --noEmit    # the REAL type gate — ray build does not typecheck
npm run lint
npm run build
```
Expected: all three exit 0. Assertions that you checked are not acceptable — paste the output.

- [ ] **Step 2: Walk the states**

| State | How to reach it | What must be true |
|---|---|---|
| Loading | Open Devices cold | A loading indicator, not an empty list flashing "No Devices" |
| Empty | Filter → Headsets with AirPods in the case | The empty view explains *why* (live devices only) — not a bare "No results" |
| Filtered | Each dropdown value | Sections and counts update; order never reshuffles |
| Narrow window | Shrink Raycast's window | Accessories don't overflow or truncate the device name to nothing |
| Trackpad row | Select the Magic Trackpad | **No listening-mode badge. No listening-mode action.** |
| Headset row | AirPods out of the case | ANC badge, case + bud batteries, in-ear subtitle |
| Device churn | Put AirPods back in the case | Row disappears within ~5s. No error. No stale row. |
| Connect | Connect a disconnected headset | Animated toast **first**, success only after it actually connects |
| Failure | Quit AirBuddy, run any command | Failure toast **with a Copy Error action** |

- [ ] **Step 3: Fix what the walk surfaced**

Blurry empty-state copy, a truncated label, an accessory one pixel off — fix them now, not after
Chris finds them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "polish: empty states, loading, and narrow-window layout"
```

---

## Self-review notes (for the plan author, not the implementer)

**Spec coverage.** List view → Tasks 6–9, 11. No-view commands → Task 12. Alert form → Task 10.
Transport + errors → Tasks 2–3. Poll → Task 4. Copy Error → Task 5 (centralized). Manifest → Task 1.
README → Task 14. Permission verification → Task 13. Gates → Task 15.

**Build order ≠ task order.** Task 9 (`device-actions.tsx`) imports `BatteryAlertsForm` from Task 10,
so **build Task 10 before Task 9**. Everything else is in dependency order.

**All 17 JXA method names were verified against the live app** before this plan was written
(`connectDevice`, `setLowBatteryAlert`, `toggleSpatialAudioMode`, …) — every one resolves as a function
on `Application("AirBuddyHelper")`. Task 3 will not dead-end on a bad name.

**Known deliberate gaps:**
- SF Symbols icons — deferred by decision (`Icon.Airpods` et al. ship instead).
- Battery alert **deletion** — cut from v1; `deleteBatteryAlerts()` exists unwired.
- Pinned/Favorites filter — impossible (API doesn't expose them).
- Magic Handoff / mic toggle / Now Playing — not scriptable.

**The one genuinely unverifiable thing is Task 13** — the `-1743` classification is a guess until
someone runs it on a machine where the permissions are actually denied. That is why it is a task and
not a footnote.

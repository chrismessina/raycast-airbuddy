import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AppState, BatteryAlertKind, BatteryPosition, Device, ListeningMode } from "./types";

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
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, ...args], {
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });

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

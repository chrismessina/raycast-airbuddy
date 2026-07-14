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

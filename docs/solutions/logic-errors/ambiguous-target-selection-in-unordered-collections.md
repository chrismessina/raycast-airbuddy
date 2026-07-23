---
title: Resolve headset target ambiguity by targeting AirBuddy's output route instead of array position
date: 2026-07-14
category: docs/solutions/logic-errors
module: src/airbuddy.ts
problem_type: logic_error
component: tooling
symptoms:
  - "Toggling listening mode with two headsets connected sometimes flips the mode on the wrong headset and reports a timeout/failure even though AirBuddy actually succeeded"
  - "Disconnect Headset intermittently times out with two headsets connected (disconnects one, polls for a different one to change)"
  - "An early fix attempt could construct a `disconnect device` call against the user's own Mac when built-in speakers are the active output route"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components: [toggle-listening-mode.ts, set-listening-mode.tsx, disconnect-headset.ts, device-actions.tsx]
tags:
  [
    jxa,
    applescript,
    osascript,
    raycast-extension,
    race-condition,
    false-negative,
    output-route,
    target-selection,
    unordered-collection,
    polling,
  ]
---

# Resolve headset target ambiguity by targeting AirBuddy's output route instead of array position

## Problem

Several commands in this Raycast extension (Toggle Listening Mode, Set Listening Mode, Disconnect
Headset, and the per-row Spatial Audio action) need to pick "which headset does the user mean" before
dispatching an AppleScript command to AirBuddy via `osascript -l JavaScript`. The original code picked a
target with `devices().find(d => supportsListeningMode(d) && d.connected)` — the first match in the
array returned by AirBuddy's `devices` AppleScript collection, which has no documented ordering
guarantee. Several of AirBuddy's own commands (`toggle listening mode`, `disconnect headset`) also
accept an _optional_ device parameter — called bare, AirBuddy resolves its own target internally and
opaquely. With two headsets connected simultaneously, the extension's guess and AirBuddy's internal
guess could disagree: AirBuddy changes device B while the extension polls device A, the poll times out,
and the UI reports a false failure for a command that actually succeeded.

## Symptoms

- With two headsets connected (e.g. AirPods + a second headset), Toggle/Set Listening Mode occasionally
  reports "never switched modes" even though AirBuddy did switch a headset's mode — just not the one the
  code polled.
- Disconnect Headset either polled for "zero headsets remain" (over-broad — spins to timeout when
  AirBuddy only disconnects one of two) or, in a follow-up attempt, polled the _wrong specific_ headset
  because the id it picked from `devices()` disagreed with the one AirBuddy actually acted on.
- A later fix pass, before it added a `kind` check, could pick the user's own Mac (`kind: "host"`) as the
  disconnect target when the Mac's built-in speakers were the active output route, and would have
  reported "Disconnected \<Mac name\>" for a command named "Disconnect Headset."

## What Didn't Work

1. **Pick the first array match.** `src/toggle-listening-mode.ts` originally used
   `devices().find(d => supportsListeningMode(d) && d.connected)` (commit `71c24cd`, later replaced in
   `13d9c82`). Wrong on two counts: `devices()` has no documented ordering, so "first match" is
   arbitrary; and the AppleScript command, called bare, picks its own target independently, so the
   extension's guess and AirBuddy's guess can simply disagree.

2. **Fix the postcondition, not the target (`disconnect-headset.ts`, commit `e3a4ec2` → `71c24cd`).**
   The first fix pass corrected the over-broad "poll until zero headsets are connected" (`c1b7af1`) —
   which spun to timeout whenever a second headset stayed connected — by polling a _specific_ headset id
   (`71c24cd`: `devices.find((d) => d.id === targetId)?.connected !== true`). This closed the "zero
   headsets" over-broad bug but introduced a new one: the specific id was still just `devices().find(...)`'s
   guess, no more likely to be the id AirBuddy's own bare `disconnect headset` command chose to act on.

3. **`getOutputDevice()` without a `kind` field (commit `13d9c82`).** The real fix — reading AirBuddy's
   `current output device` property instead of guessing from the array — was introduced in `13d9c82`, but
   the initial `OutputDevice` interface carried only `{ id, name, connected, listeningMode,
supportedListeningModes }`. Since `current output device` can resolve to _any_ device including the
   user's own Mac when built-in speakers are the active route, `disconnect-headset.ts` treated any
   non-null output as a disconnectable headset. An independent second-opinion review (Codex, commit
   `dbd27ce`) found the resulting failure scenario: Mac speakers active as output → Disconnect Headset
   targets the Mac → calls `disconnect device` on it → reports "Disconnected \<Mac name\>" for a command
   literally named "Disconnect Headset." (session history, Codex, 2026-07-14 — see Related Issues)

## Solution

Added `getOutputDevice()` to `src/airbuddy.ts:334-336`, backed by a JXA script (`src/airbuddy.ts:303-318`)
that calls AirBuddy's `current output device` AppleScript property — the device the user is _actually_
listening to right now, not a guess from an unordered collection:

```ts
// src/airbuddy.ts:303-318
const GET_OUTPUT_DEVICE = `
function run() {
  const app = Application("AirBuddyHelper");
  var d = null;
  try { d = app.currentOutputDevice(); } catch (e) { d = null; }
  if (!d) return JSON.stringify(null);
  return JSON.stringify({
    id: d.id(),
    name: d.name(),
    kind: d.kind(),
    connected: d.connected(),
    listeningMode: d.listeningMode(),
    supportedListeningModes: d.supportedListeningModes()
  });
}
`;
```

The `OutputDevice` type (`src/airbuddy.ts:320-332`) carries a `kind: DeviceKind` field, added
specifically to close the "could target the user's own Mac" hole (commit `dbd27ce`):

```ts
// src/airbuddy.ts:320-332
export interface OutputDevice {
  id: string;
  name: string;
  // The current output route is any `device` — including THIS MAC when its built-in speakers are
  // the active route. Without `kind`, disconnect-headset.ts treated any non-null output as a
  // disconnectable headset, so it could call `disconnect device` on the user's own Mac and report
  // "Disconnected <Mac name>" for a command literally named "Disconnect Headset". Callers MUST
  // check `kind === "headset"` before treating this as a headset target — or, more precisely as of
  // AirBuddy 911 (see Update note below), `supportedActions.includes("disconnect")`.
  kind: DeviceKind;
  connected: boolean;
  listeningMode: ListeningMode | null;
  supportedListeningModes: ListeningMode[];
  supportedActions: DeviceAction[];
}
```

> **Updated 2026-07-17 (AirBuddy 911 migration).** `disconnect-headset.ts`'s gate changed from
> `output?.kind === "headset"` to `output?.supportedActions.includes("disconnect") ?? false` —
> `supportedActions` is AirBuddy 911's new, state-aware, per-device capability list (live-verified: a
> connected headset gains `"disconnect"` that a disconnected one lacks, which `kind` alone could never
> express). `device-actions.tsx`'s equivalent guard changed the same way (`isConnectable`/
> `isDisconnectable` in `src/types.ts`, now `supportedActions.includes("connect"/"disconnect")` instead
> of `kind === "headset"`) — `kind`-based capability checks are superseded across the codebase, not
> just at this one call site. `listeningMode` is now `ListeningMode | null` (911 fixed the poisoning
> bug this doc's sibling problem-class touches; see `docs/solutions/` history via `git log` for prior
> state if needed). The core PATTERN this doc documents — prefer a singular accessor
> (`getOutputDevice()`) over guessing from the unordered `devices()` array, and pass explicit targets
> rather than relying on a command's opaque bare-form resolution — is unchanged and still fully
> applies; only the capability-check mechanism changed.
>
> **Superseded 2026-07-22 (AirBuddy 912).** The paragraph below was correct for build 911 but is now
> WRONG — do not trust it for current AirBuddy versions. AirBuddy 912's sdef declares the same
> `operation result` return type (`outcome`, `applied`, **`target id`**, `reason`, `connected`,
> `listening mode`) for `connect device`/`disconnect device`/`set/toggle listening mode`/`connect to
nearest headset`/`connect to favorite headset`/`disconnect headset`, and it IS now retrievable via
> this codebase's JXA transport — live-verified 2026-07-22 against real hardware:
> `app.connectDevice(id)` returned `{"outcome":"rejected","reason":"The device is already
connected.","applied":false,"connected":null,"listeningMode":null,"targetId":"<id>"}`, a real
> parsed object, not `undefined`. Whatever changed between builds — a JXA bridging fix on AirBuddy's
> side, most likely — reversed the specific limitation this doc previously documented. The codebase
> now wires this up: see `src/poll.ts`'s `assertApplied()`/`OperationRejectedError`, used at every
> connect/disconnect/listening-mode call site to fail fast on `rejected`/`failed`/`cancelled` with
> AirBuddy's own `reason` string, instead of always polling to a timeout. **`pollUntil()` was NOT
> removed** — `operation result`'s `applied: true` reflects the completed Bluetooth/audio-level
> operation, not necessarily the UI-visible settle state this codebase polls for, so most call sites
> still poll after a passing `assertApplied()` check. This only removes the guaranteed-wasted wait on
> outcomes AirBuddy already reported as not-applicable. The pre-resolved-target pattern this doc
> documents (`getOutputDevice()` over guessing from `devices()`) remains necessary and unchanged —
> `operation result` tells you what AirBuddy did AFTER the fact, it doesn't replace choosing the
> right target BEFORE the call.
>
> Original (911-era, now superseded) note, kept for history: AirBuddy 911's sdef declared the same
> `operation result` type, but live-verified (2026-07-17) that JXA returned `undefined` for all of
> these commands despite the declared return type — attributed at the time to a JXA limitation
> bridging complex AppleScript record types from third-party dictionaries. That limitation no longer
> reproduces on build 912.

**`src/toggle-listening-mode.ts:18-29`** now reads and polls the output-route device instead of guessing
from `devices()`, and passes the id explicitly to `toggleListeningMode()` rather than calling it bare:

```ts
// src/toggle-listening-mode.ts:18, 26-29
const output = await getOutputDevice();
...
const target: OutputDevice = output;
const previous: ListeningMode | null = target.listeningMode; // nullable as of AirBuddy 911
await toggleListeningMode(target.id);
```

`toggleListeningMode()` itself (`src/airbuddy.ts:365-375`) documents the same rationale: the sdef's
direct parameter is optional, and passing the id whenever known removes AirBuddy's own internal target
resolution from the equation.

**`src/set-listening-mode.tsx:33-58`** (a Form command, not a `.ts` no-view command) uses
`getOutputDevice()` in a `useEffect` and calls `setListeningMode(mode, output.id)`, polling
`getOutputDevice()` again for the postcondition rather than `getDevices()`.

**`src/disconnect-headset.ts:27-51`** switched from the ambiguous bare `disconnect headset` to the
explicit-target `disconnect device <id>`, and gates target selection on `kind === "headset"`:

```ts
// src/disconnect-headset.ts:27-33 (as of AirBuddy 911; kind === "headset" superseded, see Update note above)
const output = await getOutputDevice();
const outputIsHeadset = output?.supportedActions.includes("disconnect") ?? false;

// Fall back to any connected headset if the output route isn't a headset (built-in speakers
// active, or connected but not routed).
const fallback = outputIsHeadset ? null : (await getDevices()).find((d) => d.kind === "headset" && d.connected);
const target = outputIsHeadset ? output : fallback;
```

It then calls `disconnectDevice(targetId)` (`src/airbuddy.ts:227-229`, wrapping the sdef's
`disconnect device <id>`) instead of the old bare `disconnectHeadset()` (`src/airbuddy.ts:338-341`,
still present but no longer used by this command), and polls that specific id
(`src/disconnect-headset.ts:48-51`) — so the poll cannot disagree with what AirBuddy actually did,
because the command told AirBuddy exactly what to do.

**`src/components/device-actions.tsx`** was _not_ changed to use `getOutputDevice()` for its per-row
`handleSetMode` (`device-actions.tsx:107-135`) — that handler correctly targets `device.id`, the
specific row the user clicked, which is the right per-row semantics and not the ambiguous case.
`handleToggleSpatialAudio` (`device-actions.tsx:74-105`) also passes `device.id` explicitly to
`toggleSpatialAudio()` (never called bare), consistent with `toggleSpatialAudio()`'s own doc comment
at `src/airbuddy.ts:377-381` ("called bare, the command acts on whatever currently owns the output
route — so a UI that offers this per-device would toggle one headset while the toast names another").

## Why This Works

The output route is the one AirBuddy-side concept that unambiguously answers "which device is currently
in use" — it is not an array with unclear ordering, it is a singular "the device currently serving as
output" property (`current output device` in the sdef, exposed as `currentOutputDevice()` in JXA —
`src/airbuddy.ts:305-307`). Preferring `disconnect device <id>` / passing an explicit device id to
`toggleListeningMode`/`setListeningMode` over the bare/ambiguous forms removes a _second_ source of
guessing — AirBuddy's own internal target resolution — not just the client's. Once both the extension's
target selection and the command's target selection agree (because the command was told explicitly), the
poll's postcondition can no longer disagree with what AirBuddy actually did.

## Prevention

- **When an API exposes both (a) an unordered/order-undocumented collection and (b) a singular "current
  active X" property, prefer the singular property for "which one does the user mean."** Do not use
  array position as a stand-in for salience or activity. `devices()` (array, unordered) vs.
  `current output device` (singular, unambiguous) — see the doc comment on `getOutputDevice()` at
  `src/airbuddy.ts:290-301` for the reasoning captured in-repo.
- **When a command accepts an optional target parameter, treat "called bare" as the API doing its own
  internal target resolution, opaquely.** If your code separately guesses a target and polls for a
  change on _its_ guess, the two guesses can disagree, producing a false failure on postcondition-check
  even when the real action succeeded. Prefer passing the target explicitly whenever the API supports
  it — this closes off the API's independent guess entirely, and is strictly safer than trying to guess
  the API's guess correctly. See the doc comments at `src/airbuddy.ts:359-364` (`toggleListeningMode`)
  and `src/airbuddy.ts:377-381` (`toggleSpatialAudio`).
- **When adding a "read the current/active X" helper as a fix, populate every discriminating field on it
  up front — not just the fields the immediate call site needs.** The initial `OutputDevice` type
  omitted `kind`, and that incomplete type is exactly what let `disconnect-headset.ts` treat the user's
  own Mac as a headset target (commit `13d9c82`, follow-up fix in `dbd27ce`). The type gets reused by
  sibling call sites; give every caller the field it needs to make the right branch decision, even if
  the first caller doesn't need it yet.
- **After fixing this class of bug in one call site, grep for structurally similar call sites** — same
  shape: "pick a target device, dispatch an ambiguous/optional-target command, poll for a
  postcondition." In this codebase that pattern recurred across `toggle-listening-mode.ts`,
  `set-listening-mode.ts` (later rewritten as the Form-based `set-listening-mode.tsx`), and
  `disconnect-headset.ts`; all three were fixed together in commit `13d9c82`, and the `kind` gap in
  `disconnect-headset.ts` was still caught only via a second,
  independent adversarial review pass after the first fix pass shipped (session history, Codex,
  2026-07-14: a diff-bounded re-review scoped explicitly to only the newest commits found this). Don't
  assume one review pass surfaces every sibling instance of a pattern — a second, independent review of
  the same diff is what caught this one.

## Related Issues

- Commit `c1b7af1` — original `disconnect-headset.ts`, polls for "zero headsets remain" (over-broad
  postcondition).
- Commit `e3a4ec2` / `71c24cd` — intermediate fix, polls a specific `devices()`-guessed id (still
  guessing).
- Commit `13d9c82` — introduces `getOutputDevice()` and switches `toggle-listening-mode.ts`,
  `set-listening-mode.tsx`, and `disconnect-headset.ts` to target the output route; `OutputDevice`
  initially has no `kind` field.
- Commit `dbd27ce` — independent re-review finds the Mac-as-disconnect-target hole; adds
  `kind: DeviceKind` to `OutputDevice` and gates `disconnect-headset.ts` on `kind === "headset"`.
- `FEEDBACK.md` (gitignored, not tracked in this repo) documents the underlying upstream constraint this
  fix works around: AirBuddy's own scripting dictionary (`AirBuddyHelper.sdef`) documents device-targeting
  operations only in prose ("the headset"), with no machine-readable way for a client to know which
  device an operation like `disconnect device` actually applies to. That ambiguity in AirBuddy's own API
  is what forces this extension's defensive target-resolution logic in the first place (session history,
  Codex editorial review of `FEEDBACK.md`, 2026-07-14).

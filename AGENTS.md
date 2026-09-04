# Agent Guidelines for AirBuddy

> Instructions for AI coding assistants working on this codebase.

This extension is a remote control for the [AirBuddy](https://airbuddy.app) macOS app: browse the
devices AirBuddy sees with their batteries and connection state, connect and disconnect headsets,
change listening and Spatial Audio modes, and edit battery alerts. It owns no Bluetooth logic of its
own — every command is an Apple event sent to `AirBuddyHelper`, and the extension's real job is
deciding **which device to send it to** and **how to know it worked**.

## Before making changes

- `docs/scripting-airbuddy.md` — AirBuddy's own AppleScript/JXA dictionary, from its author.
  This is the reference for what commands and properties exist; `src/airbuddy.ts` is the pattern for
  wiring one in. If you are adding a capability, read both.
- `CONCEPTS.md` — the vocabulary. **Device**, **Output Route**, and **Supported Actions** have
  precise meanings here and the distinctions are load-bearing (see the trap below).
- `docs/solutions/logic-errors/ambiguous-target-selection-in-unordered-collections.md` — the
  post-mortem for the trap below, with the exact symptoms it produced.
- The doc comments in `src/airbuddy.ts`, `src/poll.ts`, and `src/types.ts`. They record what was
  *live-verified against real hardware* versus what was inferred from the sdef. Do not delete one
  because it looks verbose — several of them are the only record that a plausible-looking
  alternative was tried and was wrong.

## The trap: acting on one device and reporting on another

This is the mistake this codebase makes, repeatedly, in every form. AirBuddy's device collection is
**unordered**, and several of its commands pick their own target when called bare. So the tempting
shape — `devices().find(d => d.connected && …)` to choose a target, or `toggleListeningMode()` with
no argument and then poll whichever device you guessed — flips the mode on the user's Beats while
polling their AirPods, times out, and reports failure for an operation that worked. The inverse is
worse: a green success toast naming a device the command never touched.

The history is a straight line of this same bug:

- `9831f2e` — spatial audio reported success without polling its postcondition at all.
- `0404956` / `dbd27ce` — the target resolver could offer Connect on, and later `disconnect device`
  against, the user's **own Mac**, because the output route is any `device`, including `kind: "host"`.
- `3eaa0db` — Spatial Audio offered on rows it can't affect; it is an *application*-level property
  that always acts on the output route regardless of what you pass it.
- `87723ef` — `getOutputDevice()`'s rejection handler stored `null` on any error, so
  "AirBuddy isn't running" and "scripting is disabled" both rendered as "No Headset Connected" —
  the wrong recovery path.

The rules that came out of it, all enforced in code:

1. **Resolve the target explicitly, then name it in the call.** `getOutputDevice()` is the honest
   answer to "which headset does the user mean" — it is singular, unlike the collection. Pass the
   id: `toggleListeningMode(target.id)`, `disconnectDevice(id)` rather than bare `disconnectHeadset()`.
2. **The output route is not necessarily a headset.** Gate on
   `supportedActions.includes("disconnect")` (see `isDisconnectable` in `src/types.ts`), never on
   `kind === "headset"` and never on non-null-ness.
3. **Gate every action on its own `supportedActions` string**, not on device kind. The list is
   state-aware: a connected headset carries actions a disconnected one lacks. Default it to `[]`
   (`device.supportedActions ?? []`) — a mid-restart helper returns incomplete device objects, which
   crashed the action panel during development.
4. **Poll the same handle you acted on.** `nearestHeadset()` and `favoriteHeadset()` resolve devices
   that are *absent* from `devices()` (AirPods in their case), so polling `getDevices()` for their id
   spins to the full timeout on a connect that succeeded. Match on `id`; names are not unique.
5. **Never report success on a command's return.** AirBuddy returns when the request is accepted,
   not when Bluetooth settles.

A smaller variant of the same disease: the **AirBuddy Settings path appears in two places** —
`README.md` and the `ScriptingDisabledError` branch of `src/components/error-views.tsx`. It was wrong
in both (`Advanced` instead of `General`), and the two were fixed four hours apart in separate
commits (`e2a0bd5`, then `c28a1e6`) because the first fix missed the copy in the UI. If you correct a
setup instruction, grep for it.

## Architecture

**The transport** (`src/airbuddy.ts`) is JXA over `osascript -l JavaScript`, wrapped by `runJXA()`.
Everything else in the file is a static script constant plus a typed wrapper.

- **Scripts must be static string literals.** Values go through `args` and are read from `run(argv)`.
  Never interpolate a device name or id into script source — device names are user-editable. The
  `--` before the args is deliberate: it stops a value starting with `-` being read as an osascript flag.
- **There are two device readers with different JXA syntax.** `devices()` returns live proxies whose
  fields are **method calls** (`d.id()`); `liveDeviceSnapshots()` (AirBuddy 912) returns value records
  whose fields are **plain properties** (`d.id`). Copying `GET_DEVICES` and swapping the collection
  name silently yields garbage. Snapshots are ~59× faster (one Apple event vs. ~15 round-trips per
  device) but cover only live devices — `getDevices()` is still required for the full known roster.
- **Errors are classified on the message, not the OSA code.** `-1743` is a generic "Apple event not
  permitted" that fires both for AirBuddy's scripting toggle and for macOS Automation consent, which
  are different settings in different apps needing different fixes. `classifyError()` matches on
  AirBuddy's own descriptive text first. Note it matches both `'` and U+2019 apostrophes, because
  osascript emits the curly one.
- **`AbortSignal` must reach `execFile`.** `useCachedPromise` does not inject it — see the comment in
  `src/hooks/use-devices.ts`. Without it, navigating away leaves an osascript child alive for the
  full 10s timeout.

**Result handling** (`src/poll.ts`): `assertApplied(result)` fails fast when AirBuddy's
`operation result` says `rejected`/`failed`/`cancelled` — its `reason` is always a better message
than a generic 10s timeout. On `applied`, still `pollUntil()` the postcondition, and always pass a
`description`, or six different failures produce the same unusable string.

**Feedback** (`src/feedback.ts`): two local wrappers, picked by whether a toast is already on
screen. `showFailure(title, error)` fires a **new** failure toast — use it in a `catch`, where
there is a thrown error to report. `failToast(toast, title, message)` **converts an
already-showing** animated toast — use it in a pre-flight guard branch ("no headset connected"),
where nothing threw. Route every failure through one of them rather than setting
`toast.style` by hand.

**Errors as UI** (`src/components/error-views.tsx`): the four transport error classes each map to
their own recovery view. Any view command that reads AirBuddy must route errors here rather than
collapsing them into an empty state. `List.EmptyView`'s `description` collapses newlines — keep it to
one line and put steps in the actions.

## The command surface

`package.json` `commands` is the authority for the current list. What matters is which group a
change belongs to — the action commands fall into four shapes:

- **Output-route targeted** — `toggle-listening-mode`, `set-listening-mode`, `disconnect-headset`.
  Resolve via `getOutputDevice()`, guard, act by id, poll that id.
- **Handle targeted** — `connect-nearest-headset`, `connect-favorite-headset`. Resolve the handle
  first (it works when the device is absent from `devices()`), short-circuit if already connected,
  then poll the *handle*.
- **Application-level with a readable counterpart** — `toggle-spatial-audio`,
  `toggle-audio-input-lock`, `toggle-desktop-widgets-floating`. Read `getAppState()` before, toggle,
  poll `getAppState()` for the flip, and name the resulting state in the toast.
  `toggle-microphone-input` belongs here too, with one difference: **it takes no target parameter**
  — `toggleMicrophoneInput()` in `src/airbuddy.ts` is a bare call that acts on the current input
  route, the same shape as Spatial Audio. Do not pass it an id; there is none to pass. It reads the
  output route only to guard ("rejected when no routed headset is available") and to poll its
  postcondition, which is that route's `audioState`, not `getAppState()`.
- **Fire-and-forget UI dispatch** — `show-dashboard`, `show-magic-handoff-picker`,
  `cancel-device-connection`. No postcondition exists to poll; these report dispatch, not outcome —
  keep the copy honest. `show-dashboard` and `show-magic-handoff-picker` call `closeMainWindow()`
  first because they present AirBuddy UI, which would otherwise open behind Raycast.
  `cancel-device-connection` does not: it dispatches the cancellation without opening AirBuddy UI.

Two commands are declared `mode: "view"`. `list-devices` is the browse surface, composing
`useDevices` → `DeviceListItem` → `DeviceActions`. `set-listening-mode` is a view only because it
presents a live picker before acting — its behaviour is output-route targeted, per the group above.

`src/battery-alerts.tsx` is **not** a manifest command; it is a form pushed from the device action
panel. Its "Reset Alerts to Defaults" calls `delete battery alerts`, which was verified to reset
records to their disabled defaults rather than remove them — the reason it is exposed at all.

## Commands

`npm run dev` (`ray develop`), `npm run build`, `npm run lint`, `npm run fix-lint`.
There is no test suite. Verification here is hands-on against a real Mac with AirBuddy running —
the failure modes above only appear with two headsets connected, a device in its case, or the
helper mid-restart, none of which a unit test reproduces.

## Fleet conventions

House style shared across all of Chris's Raycast extensions lives in
`/Users/messina/Developer/GitHub/chrismessina/raycast-extension-workflows/plugins/raycast-extensions/reference/house-style.md`.
Read it there; it is deliberately not restated in this file.

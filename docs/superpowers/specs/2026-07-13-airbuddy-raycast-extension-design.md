# AirBuddy Raycast Extension — Design

**Date:** 2026-07-13
**Status:** Approved for planning
**Author:** Chris Messina (with Claude)

## Purpose

Expose AirBuddy 3.0's new AppleScript API through Raycast: see live devices and their batteries,
connect and disconnect, switch listening and spatial-audio modes, and manage battery alerts — without
opening AirBuddy.

## Verified API surface

Everything below was confirmed live via JXA against AirBuddyHelper 3.0 on this Mac. It is not inferred
from the dictionary.

**Target application:** `AirBuddyHelper` (not `AirBuddy` — the helper owns the live device state).

**`device` properties:** `id`, `name`, `kind` (`headset` | `mobile` | `accessory` | `host` | `Mac`),
`model`, `brand`, `address`, `connected`, `nearby`, `distance`, `source`, `audio state`, `input route`,
`output route`, `listening mode` (rw), `supported listening modes`, in-ear/in-case sensors
(`left bud in ear`, `right bud in ear`, `any bud in ear`, `left bud in case`, `right bud in case`,
`any bud in case`, `case lid closed`, `in smart case`), `updated at`.

**Nested `battery` elements:** `position` (`main` | `combined buds` | `left bud` | `right bud` |
`charging case`), `level` (0–100), `charging state` (`discharging` | `charging` | `AC power` |
`smart charging`), `low`, `charge time remaining`, `battery time remaining`, `unreliable`.

**Nested `battery alert` elements:** `kind` (`low battery` | `charged`), `position`, `threshold` (rw),
`enabled` (rw).

**Application properties:** `current output device`, `current input device`, `nearest headset`,
`favorite headset` (all read-only), `spatial audio mode` (rw).

**Commands (19):** `count`, `connect to favorite headset`, `connect to nearest headset`,
`disconnect headset`, `connect device` (+ optional `listening mode`, `microphone enabled`),
`disconnect device`, `cancel device connection`, `set listening mode`, `toggle listening mode`,
`set spatial audio mode`, `toggle spatial audio mode`, `show devices`, `show dashboard`,
`show status window`, `show device menu`, `configure battery alerts`, `set low battery alert`,
`set charged battery alert`, `delete battery alerts`.

## Constraints discovered (these drive the design)

These are the load-bearing findings. Each one rules something out.

1. **The `devices` collection returns only *live* devices.** AirBuddy's own UI shows a full roster
   (pinned-but-offline AirPods, Watches, other Macs); scripting returns only what's currently in the
   feed — 5 devices on a representative run. **Therefore:** this is a *live devices* view, not a device
   manager. We cannot offer "browse all my known devices."

2. **Pins are unreadable. Favorites ARE readable — corrected 2026-07-13, mid-implementation.**

   An earlier draft of this spec claimed `favorite headset` was broken because it returned
   `missing value`. That was wrong: no headset had been starred yet. Once one is, it resolves — and it
   returns a **full device object for a device that is not in the `devices` collection at all**:

   ```
   favorite headset → { name: "Master's AirPods Pro III", id: "747791EE-…", kind: "headset",
                        connected: false, nearby: false, supportedListeningModes: [all four],
                        batteries: [] }        ← in the case, so not reporting
   app.devices()   → 4 devices, AirPods absent (inDevicesList: false)
   ```

   So the favorite is a live handle on an *offline* device. It is the only window we have past the
   live-devices wall of constraint 1.

   **Still true:** pins are invisible; the favorite cannot be *set* from scripting; and we get exactly
   **one** favorite, not a list.

   **Therefore:** the All / Connected / Headsets filter stands — a "Favorites" filter over a single
   device is not a filter. But `connect-favorite-headset` is **no longer a blind command**: it can name
   its target up front and poll for it by name. See its section.

3. **`listening mode` returns a garbage value for non-headsets.** `listening mode` is declared on the
   `device` class rather than on a headset subclass, so *every* device answers the query — including
   devices with no speakers. Querying the Magic Trackpad returns `transparency`; the keyboard returns
   `transparency`; the host Mac returns `normal`. These are not real states. They are uninitialized
   backing values leaking through a property that should return `missing value`, and the same payload
   proves it: `supported listening modes` is `[]` for all three, so AirBuddy simultaneously reports that
   the trackpad supports zero listening modes *and* that one is currently active.

   The hazard is not that a trackpad has a listening mode — it obviously doesn't. It is that a client
   asks the obvious question, gets a confident wrong answer, and ships a "Transparency" badge next to a
   Magic Trackpad.

   **Therefore:** every listening-mode read *and* action gates on `supportedListeningModes.length > 0`,
   never on the presence or value of `listeningMode`. Encoded as the `supportsListeningMode()` helper so
   no component can reimplement it wrong.

4. **Actions are fire-and-forget.** The docs are explicit: connect/disconnect return when AirBuddy
   *accepts* the request, not when Bluetooth settles. **Therefore:** connect actions show an animated
   toast *before* the request, then poll `connected` until it flips or a timeout expires. No instant
   success toast — the UI must not lie about its state.

5. **Scripting is off by default.** The first call fails with error `-1743` until the user enables
   Settings → Advanced → Security → "Enable Apple Script for automation." **Therefore:** a typed
   `ScriptingDisabledError` and a real onboarding empty-state naming that exact path.

6. **`charge time remaining` / `battery time remaining` are always `-1`** (unavailable) across every
   device and state observed. **Therefore:** no time-remaining UI. Do not promise it.

7. **`distance` is headset-only in practice** — `immediate` for the connected AirPods, `unknown` for
   everything else including connected, nearby devices. **Therefore:** only render proximity for headsets.

8. **Battery alerts are pre-seeded and disabled.** Every device already carries `low battery` and
   `charged` alerts with thresholds, all `enabled: false`. **Therefore:** the alert form edits in place
   and never invents a part/kind combination — the sdef warns invalid configurations are possible.

9. **Magic Handoff, Toggle Mic Input, Audio Input Lock, Now Playing, and Desktop Widgets are not
   scriptable.** Confirmed: zero matches for "handoff"/"magic" in the sdef; 19 commands, none of them
   these. **Therefore:** they are out of scope. Logged in `FEEDBACK.md` for the AirBuddy developer.

## Architecture

Three layers. All AppleScript ugliness stays in exactly one of them.

### `src/airbuddy.ts` — API client

A single `runJXA<T>()` helper shelling out to `osascript -l JavaScript`, parsing JSON from stdout.
Every AirBuddy call routes through it.

JXA rather than AppleScript, deliberately: it returns real JSON (no string-parsing of AppleScript
records) and it sidesteps the `(the nearest headset)` grammar ambiguity the AirBuddy docs warn about.

#### Transport contract

Non-negotiable, because this is a shell boundary taking user-controlled device names:

- **Static script, serialized arguments.** The JXA source is a fixed string. Device IDs, names, and
  thresholds are **never interpolated into source** — they are passed as `osascript` arguments and read
  inside the script from `run(argv)`. A device named `"); doSomething(("` must be inert.
- **Strict JSON on stdout.** The script's last expression is `JSON.stringify(...)`. Anything that fails
  to parse is an error, not a fallback.
- **Schema validation on the way in.** Parsed output is validated against the expected shape before it
  becomes a `Device`. AirBuddy is beta software; a changed payload should surface as a clean error, not
  a runtime crash three layers up.
- **Bounded timeout.** Every `osascript` invocation runs under an explicit timeout (default 10s) with
  process kill on expiry. A hung `osascript` must never leave a command spinning forever.
- **stderr is preserved verbatim** and carried on the thrown error, so the Copy Error action has the
  real text.

#### Error classification

`-1743` is `errAEEventNotPermitted` — a **generic** "this Apple Event was not permitted" code. It does
**not** uniquely mean "AirBuddy's scripting switch is off." It fires for at least two distinct causes
with two different fixes:

1. **AirBuddy's own scripting switch is off** — AirBuddy Settings → Advanced → Security → "Enable Apple
   Script for automation". AirBuddy returns a *descriptive message* alongside the code ("Before running
   an Apple Script that communicates with AirBuddy, you must enable scripting in AirBuddy Settings").
2. **macOS Automation consent is denied** — System Settings → Privacy & Security → Automation → Raycast
   → AirBuddyHelper. This is the OS refusing before AirBuddy ever sees the event, so there is **no**
   AirBuddy-authored message.

**Therefore:** classify on the error *message*, not the code alone. If stderr carries AirBuddy's own
"enable scripting in AirBuddy Settings" text → `ScriptingDisabledError`. If it's a bare `-1743` with no
AirBuddy message → `AutomationConsentError`. If ambiguous, fall back to a combined onboarding view that
names **both** settings rather than confidently sending the user to the wrong one.

> **Cannot be verified on this machine.** Both permissions are already granted here, so the denied
> states are unreachable. **Plan deliverable:** verify the exact stderr text for each denial on a fresh
> machine (or by revoking consent in System Settings) *before* finalizing the classifier. Until verified,
> the combined view is the safe default.

Also classified: app-not-installed and app-not-running → their own typed errors. Everything else → a
generic `AirBuddyError` carrying the raw stderr.

Exports: `getDevices()`, `getAppState()` (routes + spatial mode), `connectDevice(id, opts)`,
`disconnectDevice(id)`, `setListeningMode(id, mode)`, `toggleListeningMode()`,
`toggleSpatialAudio()`, `showStatusWindow(id)`, `showDeviceMenu(id)`, `showDashboard()`,
`setBatteryAlert(id, kind, position, threshold, enabled)`, `deleteBatteryAlerts(id)`,
`connectNearest()`, `connectFavorite()`, `disconnectHeadset()`.

### `src/types.ts` — domain model + derived helpers

`Device`, `Battery`, `BatteryAlert`, and the enums, mirroring the sdef exactly.

Plus the helpers that encode the gotchas so no component can reimplement them wrong:

- `supportsListeningMode(device)` → `device.supportedListeningModes.length > 0` (constraint 3)
- `primaryBattery(device)` → `combined buds` for headsets, else `main`
- `caseBattery(device)` → the `charging case` battery, or undefined
- `budsDiverge(device)` → whether left/right differ enough to show separately
- `sectionFor(device)` → the List.Section title for a `kind`
- `iconFor(device)` → the Raycast `Icon`, keyed on `kind` with a `model`-based split for accessories

### Commands

`src/list-devices.tsx`, `src/battery-alerts.tsx` (pushed from the list, **not** a manifest command), and
six thin `no-view` files.

#### Manifest command inventory (deliverable)

The scaffold currently declares exactly one command, `list-devices`, as **`"mode": "no-view"`** — which
cannot host a `List` or push a form. **This must change to `"view"`.** The final `commands` array — 8
commands, all enabled by default:

| `name` | `title` | `mode` | Notes |
|---|---|---|---|
| `list-devices` | Devices | **`view`** | The list. **Scaffold currently says `no-view` — fix.** |
| `connect-nearest-headset` | Connect Nearest Headset | `no-view` | |
| `connect-favorite-headset` | Connect Favorite Headset | `no-view` | See the caveat in its section |
| `disconnect-headset` | Disconnect Headset | `no-view` | |
| `toggle-listening-mode` | Toggle Listening Mode | `no-view` | Cycles. AirBuddy picks the order |
| `set-listening-mode` | Set Listening Mode | `no-view` | **Dropdown argument** — see below |
| `toggle-spatial-audio` | Toggle Spatial Audio | `no-view` | |
| `show-dashboard` | Show AirBuddy Dashboard | `no-view` | |

`disabledByDefault` is available (verified in the official schema; serializes to `disabled_by_default`)
but is **not used** — 8 visible commands is acceptable.

`battery-alerts.tsx` is a pushed component, not a manifest entry.

#### `set-listening-mode` — dropdown argument, not a view

Toggle and Set are different intents, and both are cheap. `toggle listening mode` cycles (AirBuddy owns
the order); `set listening mode` targets one directly. The picker is a **command argument**, so the
command stays `no-view` — the dropdown renders in the root search bar, no window:

```jsonc
{
  "name": "set-listening-mode",
  "title": "Set Listening Mode",
  "mode": "no-view",
  "arguments": [{
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
  }]
}
```

**Four modes, not three** — the AirPods Pro III report `normal`, `noise cancellation`, `transparency`,
*and* `adaptive` (verified). The `data` array is **static** (manifest-declared, not runtime-populated),
which is fine because the sdef enum is fixed. But it means the dropdown lists all four regardless of what
the *current* headset supports — so the command must handle "this device doesn't support that mode"
gracefully: check `supportedListeningModes` before dispatching, and fail with a clear toast rather than
firing an AppleScript call AirBuddy will silently drop.

Argument values arrive via `props.arguments.mode`, typed by Raycast's **generated ambient types** — do
**not** hand-declare an `Arguments` interface (house style, `[lint]`).

## The list view (`list-devices.tsx`)

One row per device. Batteries render as Raycast accessories.

```
AirPods
🎧 Master's AirPods Pro III        [ANC] [🔋52%] [80%]
   In ear · Output + Input · Immediate

Macs
💻 BunnySilicon II                        [⚡100%]

iPhones, iPads, and Apple Watch
📱 JesusPhone VI                            [90%]

Keyboards, Mice, and Other Peripherals
⌨️ Master's Keyboard                       [100%]
🖱️ Master's Magic Trackpad II              [100%]
```

**Sections** derive from `kind`, titled to match AirBuddy's own Devices panel: "AirPods", "Macs",
"iPhones, iPads, and Apple Watch", "Keyboards, Mice, and Other Peripherals". Empty sections are omitted.
Because of constraint 1, a section shows only *live* devices — you will never see all three pairs of
AirPods listed, only the pair that is currently on.

**Icons** are Raycast built-ins — `Icon.Airpods`, `Icon.Desktop`, `Icon.Mobile`, `Icon.Keyboard`,
`Icon.Mouse`. Accessories use `Icon.Battery` / `Icon.BatteryCharging` / `Icon.Bolt`. Since `kind` is
`accessory` for both keyboards and trackpads, the keyboard/mouse split keys off the `model` identifier
(`Device1,671` → keyboard, `Device1,804` → trackpad) with `Icon.Devices` as fallback.

> **Deferred:** true SF Symbols (distinct AirPods Pro vs. Max vs. case glyphs, a real trackpad icon)
> would require rasterizing to PNGs in `assets/` at build time, and SF Symbols' license restricts
> redistribution — a real consideration for a Store-published extension. Ship on Raycast built-ins;
> revisit if the fidelity gap grates. If we do it, `sf-symbols-typescript` (types-only; its
> `dist/index.js` is literally `module.exports = {}`) type-checks the symbol names feeding the pipeline.

**Accessories**, right to left: primary battery, then case battery on headsets, then listening mode —
the last **only when `supportsListeningMode(device)`**, so a trackpad never shows a bogus "Transparency"
badge (constraint 3). Battery colors: red below 20%, orange below 40%, otherwise default. Charging state
shows a bolt. `unreliable` batteries render subdued rather than hidden — a suspect number is more honest
than a missing one. Left/right buds are hidden unless they diverge, matching AirBuddy.

**Subtitle** carries live context for headsets only: in-ear state, route ("Output + Input"), and
proximity. Non-headsets get no subtitle (constraint 7).

**Dropdown filter:** All (default) / Connected / Headsets. Every value is backed by a real property
(`connected`, `kind`) — nothing can go stale, nothing can be permanently empty (constraint 2).

**Refresh.** `useCachedPromise` has **no revalidation-interval option** — it offers caching, `abortable`,
and a manual `revalidate()`. (Verified against the installed `@raycast/utils` types.) So the polling is
ours to build, explicitly:

> **Type trap, named in house style and directly applicable here.** `useCachedPromise` has multiple
> overloads, and an unannotated fetcher **silently resolves to the paginated overload**, inferring `data`
> as `any[]` — which then sails past the no-`any` lint rule because nobody wrote the word `any`.
> **Annotate the fetcher's return type** to pin the intended overload:
> `const fetchDevices = (): Promise<Device[]> => getDevices()`. This is exactly the hook at the center of
> this view, so it is a design constraint, not an implementation detail.

- A `useEffect`-owned `setInterval` (5s) calling `revalidate()`, **cleared on unmount.**
- **Non-overlapping:** an in-flight guard skips a tick if the previous `osascript` has not returned.
  Slow AppleScript must not stack up a queue of subprocesses.
- **Bounded:** each call inherits the transport timeout, so a stuck `osascript` fails rather than
  hanging the list forever.
- **Abortable:** the `abortable` ref is wired so navigating away cancels in flight work.

The interval is a constant, not a preference — a knob nobody will turn is not worth a settings row.

### Actions

Per house style: `Keyboard.Shortcut.Common` by semantics, no collisions within a resolved panel.

| Action | Shortcut | Notes |
|---|---|---|
| Connect / Disconnect | `↵` (primary, auto) | Whichever applies to the row's current state |
| Listening Mode submenu | `⌘L` (custom) | **Rendered only if `supportsListeningMode(device)`** |
| Show Status Window | `Common.Open` (`⌘O`) | `show status window <id>` |
| Show Device Menu | `Common.OpenWith` (`⌘⇧O`) | `show device menu <id>` |
| Configure Battery Alerts | `Common.Edit` (`⌘E`) | Pushes `battery-alerts.tsx` |
| Toggle Spatial Audio | `⌘⇧S` (custom) | Global, not per-device; second panel section |
| Refresh | `Common.Refresh` (`⌘R`) | Revalidate |
| Copy Device ID | `Common.Copy` (`⌘⇧C`) | |
| Copy Device Name | `Common.CopyName` (`⌘⇧.`) | |

**On the two custom shortcuts.** `Keyboard.Shortcut.Common` has no member meaning "switch mode" or
"toggle a setting," so `⌘L` (listening) and `⌘⇧S` (spatial) are deliberately custom. Forcing a bad
semantic match onto a `Common` constant would be worse than an honest custom shortcut.

**This extension is macOS-only** (AirBuddy is Mac-only; `platforms: ["macOS"]`), so custom shortcuts are
written as **plain objects**. The platform-explicit `{ macOS, Windows }` form is only required for
extensions that actually ship on both platforms — on a Mac-only extension it is dead weight implying a
portability that doesn't exist:

```ts
shortcut={{ modifiers: ["cmd"], key: "l" }}
```

> If this extension ever gained a Windows target, custom shortcuts would take the platform-explicit
> form — and note the key is **`Windows`**, capitalized. Lowercase `windows` exists only as a
> `@deprecated` alias and does **not** satisfy the required property (verified against the installed
> `@raycast/api` types). `Common` constants are already platform-aware and are never wrapped either way.

**Conflict invariant:** the resolved panel — including actions inside the listening-mode submenu — must
contain no two actions on the same shortcut. The first action auto-binds `↵` and the second auto-binds
`⌘↵`; no assigned shortcut may duplicate those. Verify after wiring.

### Connect flow (constraint 4)

1. Show an animated toast **before** dispatching the request. (Silence during a long operation is a bug.)
2. Dispatch `connect device`.
3. Poll `connected` on a short interval until it flips true, or a timeout (~10s) expires.
4. Success → success toast. Timeout → failure toast, which **carries a Copy Error action** per house style.

Never show a success toast on request-accept. The request being accepted is not the device being
connected.

### Empty & error states

- **Scripting disabled (`-1743`):** an onboarding `List.EmptyView` naming the exact path — AirBuddy
  Settings → Advanced → Security → "Enable Apple Script for automation" — with an action to open
  AirBuddy.
- **AirBuddy not installed:** its own empty view, with a link to the AirBuddy site.
- **AirBuddy not running:** empty view with an action to launch it.
- **Genuinely no devices:** effectively unreachable (the host Mac is always in the feed), but handled.

## No-view commands

Seven, each wrapping a single scriptable command.

**Constraint 4 applies here too — the HUD must not lie.** Every one of these is fire-and-forget. A HUD
reading "Connected" when AirBuddy has merely *accepted* the request is the same defect as an instant
success toast in the list. So each command declares its postcondition explicitly:

| Command | Calls | Postcondition | HUD |
|---|---|---|---|
| Connect Nearest Headset | `connect to nearest headset` | Poll `nearest headset → connected` | **Polled.** "Connected to X" only once true; timeout → failure |
| Connect Favorite Headset | `connect to favorite headset` | Poll `favorite headset → connected` | **Polled**, same. See caveat below |
| Disconnect Headset | `disconnect headset` | Poll → `connected` false | **Polled.** "Disconnected" only once false |
| Toggle Listening Mode | `toggle listening mode` | Re-read `listening mode` | **Polled.** HUD names the *resulting* mode ("Transparency"), which requires the read anyway |
| Set Listening Mode | `set listening mode <arg>` | Re-read `listening mode` | **Polled.** Pre-flight: reject unsupported mode before dispatch |
| Toggle Spatial Audio | `toggle spatial audio mode` | Re-read `spatial audio mode` | **Polled.** HUD names the resulting mode |
| Show AirBuddy Dashboard | `show dashboard` | *None* — UI command | **Immediate.** Nothing to poll; showing a window has no async state |

Only `show dashboard` earns an immediate HUD, because it has no state to settle. The polls reuse the
list's poll helper (bounded, non-overlapping) — one implementation, not two.

**Connect Favorite Headset — upgraded (constraint 2, corrected).** `favorite headset` resolves a full
device object, *including for a headset that is offline and absent from `devices`*. So this command is
no longer blind:

1. Read `favorite headset` **first**. It returns `{ id, name, … }` even if the AirPods are in their case.
2. If it's `missing value` → fail immediately with an honest, actionable toast: *"No favorite headset.
   Star one in AirBuddy's Devices settings."* Do not dispatch a connect that cannot succeed.
3. Otherwise, name the target in the animated toast up front — *"Connecting to Master's AirPods Pro
   III…"* — then dispatch and **poll for that specific device id** becoming `connected`.

This is strictly better than the earlier design (which polled for "any headset became connected"
because it couldn't name the target): it can't misattribute a coincidental connection to the favorite,
and the user sees which device they're waiting on.

## Battery alert form (`battery-alerts.tsx`)

Pushed from the list via `⌘E`. Not a manifest command.

**Deletion is omitted from v1.** The original design paired "only edit alerts AirBuddy already reports"
with a `delete battery alerts` action — which is a trap: deleting removes the very records the form
edits, leaving the user with an empty form and **no way to recreate them**, because the fail-closed rule
forbids inventing part/kind combinations. Whether AirBuddy re-seeds deleted alerts is unverified, and I
will not ship a destructive action whose recovery path is unknown. `deleteBatteryAlerts()` still exists
in the client for future use; **no UI invokes it.**

### The projection (complete, unambiguous)

Render **exactly one row per alert AirBuddy reports for that device** — no more, no less. Observed:

| Device kind | Alerts AirBuddy reports | Rows rendered |
|---|---|---|
| Headset (AirPods Pro III) | `low`+`charged` × `left bud`, `low`+`charged` × `charging case` | **4** |
| Accessory / mobile / host | `low`+`charged` × `main` | **2** |

The earlier draft said both "one field per reported alert" *and* "headsets get left-bud/case rows" — the
same thing stated two ways, which read as a contradiction. To be explicit: the reported alert list **is**
the projection. There is no separate rule for headsets; a headset simply happens to report four alerts.
Note the `left bud` entry is how AirBuddy stores bud alerts when there is no `main` part (per its docs),
so it is labelled **"Earbuds"** in the UI, not "Left Bud" — the underlying `position` is passed through
untouched.

Each row: an `enabled` checkbox and a `threshold` field, seeded from current values.

### Validation, atomicity, feedback

- **Validation:** threshold must be a number in 0–100. Enforced by `Form.TextField` `onBlur` validation;
  a bad value blocks submit with an inline error rather than firing an AppleScript call that AirBuddy may
  silently reject.
- **Save** (`Common.Save`, `⌘S`) issues one `set low battery alert` / `set charged battery alert` call
  per **changed** row (unchanged rows are skipped — no need to rewrite what didn't move).
- **Atomicity: there is none, and the UI must not pretend otherwise.** These are N independent
  fire-and-forget AppleScript calls; AirBuddy offers no transaction. If call 3 of 4 fails, calls 1–2 have
  already applied. On any failure the toast says exactly that — which rows applied, which did not — and
  carries a **Copy Error** action. Popping back to the list on partial success would be a lie.
- On full success: success toast, pop back to the list.

## Out of scope for v1

- **Menu-bar command.** AirBuddy's own menu bar is feature-complete; duplicating it adds nothing.
- **Pinned / Favorites filter.** Unreadable from the API (constraint 2).
- **Magic Handoff, mic toggle, audio input lock, Now Playing.** Not scriptable (constraint 9). A hotkey
  bridge via System Events keystroke is possible but brittle (depends on personal hotkey config, needs
  Accessibility permission, breaks silently on rebind) — explicitly rejected.
- **SF Symbols icons.** Deferred; see the list-view note.
- **Time-remaining UI.** The data is always `-1` (constraint 6).

## House style

Source of truth: `raycast-extension-workflows/plugins/raycast-extensions/reference/house-style.md` +
`keyboard-conventions.md` (read from the **repo**, which is ahead of the plugin cache).

- **`npx tsc --noEmit` is the type gate.** `ray build`/`ray lint` do not check types. See Gates above.
- Every `Toast.Style.Failure` carries a **Copy Error** action. This design has many failure paths —
  scripting disabled, automation denied, AirBuddy quit, connect timeout, partial alert save — and
  **every one of them** must carry it.
- **Shortcuts, two independent axes:** `Common` where a semantic match exists (already platform-aware,
  never wrapped); custom where none does. Then — custom only — `platforms: ["macOS"]` ⇒ plain
  `{ modifiers, key }` object. This extension is Mac-only, so `⌘L` and `⌘⇧S` are plain objects. The
  `{ macOS, Windows }` form (capital `Windows`) would apply only to a cross-platform extension.
- **Conflict invariant:** within a resolved ActionPanel — *including nested submenus* — no two actions
  share a shortcut. The listening-mode submenu makes this live, not theoretical.
- No hand-defined `Preferences`/`Arguments` types — use the generated ambient types.
- **No `any`** — and note the `useCachedPromise` overload trap above, which produces `any[]` *without
  anyone writing `any`*, so the lint rule alone will not catch it.
- **Closure narrowing:** TS does not carry an early-return narrowing into a nested closure. After
  `if (!device) return`, a captured `Device | null` is **still** `Device | null` inside a later
  `async function` — which the connect-poll flow is made of. Re-bind to a typed const
  (`const target: Device = device`) rather than reaching for `!` or `as`.
- The `@chrismessina/raycast-logger` rule is **conditional on web requests** and this extension makes
  none — so it does **not** apply. (Stated so the ship audit doesn't mis-fire on it.)

## Testing

**No test runner, and no test dependency — as a deliberate policy, not because the Store forbids it.**
(An earlier draft asserted "the Store rejects test dependencies." That was repeating a claim without
verifying it, and it does not belong in a spec as justification. Chris's instruction stands on its own:
he does not want one shipped.)

The real reason it costs nothing: the one test that would have justified a runner does not earn its keep.
`supportsListeningMode()` is a single expression (`supportedListeningModes.length > 0`) whose correctness
is self-evident on sight. What actually prevents the constraint-3 bug is not a test — it is that the
helper exists at all, so no component reaches for `device.listeningMode` directly.

**So the guard moves into the type system.** `supportsListeningMode()` is the only exported path to a
device's listening mode, and the raw `listeningMode` field is kept off the ergonomic surface of the
public `Device` type. A component has to go out of its way to misuse it. This is a stronger guarantee
than a unit test, because it fails at compile time rather than in CI.

**Verification is the manual matrix, against real hardware** — which is the only evidence worth trusting
at an AppleScript boundary anyway:

| State | Expected |
|---|---|
| Scripting disabled (`-1743`) | Onboarding view naming the exact Settings path |
| AirBuddy quit | Launch view |
| AirBuddy not installed | Install view |
| No headset present | `nearestHeadset` null; **no listening-mode action anywhere in the list** |
| Trackpad / keyboard / Mac rows | **No listening-mode badge, no listening-mode action** (constraint 3) |
| Headset connected, in-ear | Full accessory row; all four modes in the submenu; subtitle shows route + proximity |
| Headset in case | In-case sensors reflected; buds may diverge |
| Connect while disconnected | Animated toast *before* dispatch, then a **polled** success — never an instant one |
| Failure of any kind | Failure toast carries a **Copy Error** action |

### Permission-denial matrix (must be verified on a machine where consent is NOT already granted)

Both permissions are already granted on the dev machine, so **these states are unreachable here** and
cannot be verified by inspection. Revoke consent in System Settings (or use a fresh machine) and record
the **exact stderr text** for each:

| State | How to reach it | Expected classification |
|---|---|---|
| AirBuddy scripting switch off | AirBuddy Settings → Advanced → Security → toggle off | `ScriptingDisabledError` (stderr carries AirBuddy's own "enable scripting in AirBuddy Settings" message) |
| macOS Automation consent denied | System Settings → Privacy & Security → Automation → Raycast → uncheck AirBuddyHelper | `AutomationConsentError` (bare `-1743`, no AirBuddy message) |
| Both denied | Both of the above | Whichever fires first; the combined view is acceptable |

**This is a plan deliverable, not an optional check.** Until the stderr strings are recorded, the
classifier ships the combined onboarding view that names both settings — because sending a user to the
wrong Settings pane is worse than naming two.

### Gates (these replace the test suite, and are not optional)

- **`npx tsc --noEmit` — the real type gate.** `ray build` (esbuild) and `ray lint` (ESLint) **strip and
  skip types without checking them**, so passing build + lint is *not* evidence the code typechecks. A
  non-zero `tsc` exit is a failure even when `ray build` succeeds. (House style, `[both]`.)
- `npm run lint` — clean.
- `npm run build` — clean (`ray build`).
- **Test the distribution build**, not just `ray develop`, per Raycast's Store guidance.

Report each with its raw output, not an assertion that it was checked.

**Before calling it done:** walk the empty / loading / filtered / narrow-window states. A first working
build is not a finished one.

## README (required, and a real deliverable)

Raycast requires a README when an extension needs non-trivial external setup — and this one needs *two*
separate permissions that live in *two* different apps. Without it, the first-run experience is an error
message the user cannot act on.

`README.md` must cover: that AirBuddy 3.0+ is required; enabling **AirBuddy Settings → Advanced →
Security → "Enable Apple Script for automation"**; granting **macOS Automation consent** (System Settings
→ Privacy & Security → Automation → Raycast → AirBuddyHelper) when macOS prompts on first run; and the
honest scope limits — that only **live** devices appear (not AirBuddy's full pinned roster), and that
pins/favorites are not readable from the API.

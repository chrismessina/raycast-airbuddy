# Contributing to AirBuddy

Thanks for helping. This guide covers running AirBuddy locally and sending a change.

## Where changes go

AirBuddy is published in the [Raycast Store](https://www.raycast.com/chrismessina/airbuddy).
Open pull requests against [`raycast/extensions`](https://github.com/raycast/extensions/tree/main/extensions/airbuddy),
not this repository: Raycast reviews every change there, and merged changes come back here in a
sync pull request. Open [issues](https://github.com/chrismessina/raycast-airbuddy/issues) here or in
`raycast/extensions`, whichever you prefer.

## Run it locally

You need [Raycast](https://www.raycast.com/) and Node.js 22.22.2 or later.

1. In Raycast, find AirBuddy in the Store and choose **Fork Extension** from the action panel.
   Raycast checks out only this extension's folder from `raycast/extensions`.
2. In that folder, run `npm ci`, then `npm run dev`. Raycast opens the development version, and
   saving a file reloads it.

You also need [AirBuddy](https://airbuddy.app) 3.0 (build 913) or later, with **Enable Apple Script
for automation** turned on in its Settings, and macOS Automation permission for Raycast to control
**AirBuddyHelper** (see the README's Setup section).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the extension in Raycast and reload on save |
| `npm run build` | Build the distribution bundle |
| `npm run lint` | Run Raycast's ESLint and Prettier checks |
| `npm run fix-lint` | Fix what the linter can fix |
| `npm run publish` | Open or update the pull request in `raycast/extensions` (`ray publish`) |
| `prepublishOnly` | Stops `npm publish`: the extension goes to the Raycast Store, never to the npm registry |

## How it works

The extension owns no Bluetooth logic. Every command is an Apple event sent to `AirBuddyHelper`.

- `src/airbuddy.ts` wraps each AirBuddy command as a static JXA script run with
  `osascript -l JavaScript` (`runJXA()`). It passes values through `argv` rather than interpolating
  them, and maps AirBuddy's failure modes to typed errors (scripting disabled, Automation consent
  missing, not running, not installed).
- `src/poll.ts` (`pollUntil`) polls a postcondition after an action whose result can be read back,
  because AirBuddy returns when a request is accepted, not when Bluetooth settles. Dispatch-only
  commands (Show AirBuddy Dashboard, Show Magic Handoff Picker, Cancel Device Connection) don't poll.
- `src/hooks/use-devices.ts` refreshes the device list every 5 seconds, using the fast live-device
  snapshot unless the **Known Devices** filter needs the full roster.
- `src/list-devices.tsx` and `src/components/` build the Devices view. `src/types.ts` holds the
  shared types (including the `supportedActions` gates), `src/feedback.ts` the toast and error
  helpers. `src/battery-alerts.tsx` is the battery-alert form a device action pushes, not a command;
  the other files in `src/` are one command each, named as in `package.json`.
- `scripts/render-icons.swift` renders the device icons in `assets/devices/` from SF Symbols
  (`swift scripts/render-icons.swift`).
- `docs/scripting-airbuddy.md` is AirBuddy's AppleScript/JXA dictionary from its author. In this
  repository, read it with `AGENTS.md` and `CONCEPTS.md` before adding a capability.

## Before you open a pull request

- `npm run build`, `npx tsc --noEmit` and `npm run lint` all pass.
- You tried the change in Raycast, including its error and empty states.
- `CHANGELOG.md` has a new entry at the top, dated `{PR_MERGE_DATE}`. Raycast fills in the date
  when the pull request merges.
- New or changed screenshots go in `metadata/`, taken with Raycast's Window Capture.

# AirBuddy 911 API Migration — Crib Sheet

**Purpose of this file:** survive a context compaction mid-task. Read this first on resume, then
execute autonomously — no plan approval needed, Chris said to just build it. Save UI-facing
questions for the very end.

**Standing instruction from Chris (2026-07-16):** "I would love you to... run and update the PR we
already have to accommodate all of these new changes... you can handle all of it. I don't really
want to go through all the brainstorming and other formalities... Save your questions for the end."
No brainstorm skill, no plan-approval gate. Execute, verify, ship. Only stop for genuinely
UI/UX-facing decisions — save those for one batch at the end.

## What happened

Gui Rambo (AirBuddy's developer) shipped build **3.0 (911)** — not publicly released, but Chris has
it and it's already **installed on this Mac** (confirmed: `/Applications/AirBuddy.app` is genuinely
911, auto-updated some time during this session). It directly addresses nearly every finding in
`FEEDBACK.md` (gitignored, repo root — the doc delivered to Gui after the original build).

Source of the new sdef used for this migration:
`/Applications/AirBuddy.app/Contents/Library/LoginItems/AirBuddyHelper.app/Contents/Resources/AirBuddyHelper.sdef`
(confirmed byte-identical to the copy in Chris's 911 export at
`/Volumes/BunnyCrunch/Mac Apps/AirBuddy/AirBuddy 3.0 (911)/AirBuddy 3.0 (820).app/...` — the folder
name is stale/misleading, `Info.plist` CFBundleVersion=911 confirmed both places).

**This is a live-hardware-verified migration, not a paper read of the sdef.** Every claim below was
checked with `osascript -l JavaScript` against the actual running AirBuddyHelper 911 on this Mac
before being written down. Do the same for anything not yet verified below — don't trust the sdef
prose alone, the whole discipline of this project has been "verify against real hardware."

## The sdef diff, by FEEDBACK.md finding

| FEEDBACK.md finding | 911 fix | Verified live? |
|---|---|---|
| §1 — `devices()` only returns live devices, no roster/pinned/favorite access | **`devices()` now returns the FULL KNOWN ROSTER** — 26 devices on this Mac, not 4-5. `nearby: false` distinguishes known-but-absent from live. `pinned`/`favorite` are `access="rw"` booleans, directly readable AND settable. | ✅ Live: `app.devices().length` = 26, includes offline devices, `pinned: true` reads correctly. |
| §2 — accept-and-silently-no-op, no outcome signal | New `operation result` record type: `outcome` enum (`applied`/`rejected`/`failed`/`cancelled`), `applied` bool, `target id`, `reason` text, `connected` bool, `listening mode`. Returned by `connect device`, `disconnect device`, `connect to favorite/nearest headset`, `disconnect headset`, `set/toggle listening mode`. | ⚠️ NOT yet live-tested — need to actually dispatch a command and inspect the returned record shape in JXA (JXA may flatten/rename record properties — verify before coding against it). |
| §2 — no per-device capability check | New `supported actions` property on `device` — list of stable text identifiers. | ✅ Live: headset → `["connect","show device menu","configure battery alerts","set low battery alert","set charged battery alert","delete battery alerts","pin","favorite"]`. Trackpad → `["connect","configure battery alerts","set low battery alert","set charged battery alert","delete battery alerts","pin"]` (no `"favorite"` — makes sense, only headsets can be favorited). Host Mac → no `"connect"` (correct, can't connect to yourself), no `"favorite"`. |
| §3 — `-1743` ambiguous between AirBuddy-off and macOS-denied | Release notes: "Receive a distinct error when scripting is disabled in AirBuddy settings." | ⚠️ NOT yet live-tested (would need to toggle the setting off again — same limitation as before, both permissions are currently granted on this Mac). Sdef doesn't show a new enum for this — likely still an error-string change. Re-run the same capture procedure as before if this matters; low priority since the combined-view fallback already handles it safely. |
| §4 — `listeningMode` poisons non-headsets (trackpad reported `"transparency"`) | `listening mode` is now `access="r"` (was `rw` — read-only now, makes sense given `set listening mode` command exists separately) and **returns `missing value`/`null` for devices where listening modes don't apply**, instead of a poisoned enum value. | ✅ Live: trackpad and host Mac both return `listeningMode: null`. THE TRAP IS FIXED UPSTREAM. `supportsListeningMode()` can be deleted; check `device.listeningMode !== null` directly, or keep `supportedListeningModes.length > 0` as a belt-and-suspenders (both should now agree). |
| Connect/Disconnect headset-only scoping ambiguity | `connect device` doc: "other device kinds are rejected." `disconnect device` doc: "when its current transport permits." BUT — `supported actions` shows **accessories (trackpad) DO have `"connect"`** in their supported-actions list. This is richer than "headset-only" — it's now per-device, data-driven. | ✅ Live: confirmed via `supportedActions` above. **`isConnectable()` in the current code (`kind === "headset"`) is now WRONG — too narrow.** Must be replaced with `supportedActions.includes("connect")`. |
| §9 — mic toggle, Audio Input Lock, Now Playing/Handoff | New commands: `toggle microphone input`, `toggle audio input lock`, `toggle desktop widgets`, `show Magic Handoff picker`. No Now Playing surface added (release notes don't mention it — that ask wasn't addressed). | Not yet live-tested. These are net-new optional commands, not required for parity — see "New capabilities, not required" below. |

## Full new sdef enums/types (for reference, don't re-derive)

```
operation outcome: applied | rejected | failed | cancelled

operation result (record):
  outcome: operation outcome
  applied: boolean
  target id: text (or missing value if no target resolved)
  reason: text (when applicable)
  connected: boolean (when available)
  listening mode: listening mode (when available)

device kind: headset | mobile | accessory | host | Mac   (UNCHANGED)
listening mode: normal | noise cancellation | transparency | adaptive   (UNCHANGED)
spatial audio mode: off | fixed | head tracked   (UNCHANGED)
```

New/changed `device` properties vs. the old sdef:
- `pinned` — NEW, `boolean`, `access="rw"` (was unreadable entirely)
- `favorite` — NEW, `boolean`, `access="rw"` ("setting true replaces the previous favorite")
- `listening mode` — was `access="rw"` in old sdef (odd — read confirms it was actually read-only in
  practice via `set listening mode` command), now `access="r"`, docs say returns missing value when
  N/A
- `supported actions` — NEW, `list of text`, stable string identifiers

New commands (beyond the ones already used): none that change existing call shapes materially, but
note `set spatial audio mode` / `toggle spatial audio mode` LOST their `<result type="operation
result">` in the sdef dump above (double check — they may not return a result the same way the
connect/disconnect/listening-mode commands do; verify before assuming parity).

Commands whose **descriptions** changed to state rejection semantics explicitly (useful doc-comment
fodder, not necessarily code changes):
- `connect to nearest headset` — "which may not yet be present in the live device feed"
- `disconnect headset` — "rejected when no disconnectable headset is connected"
- `connect device` — "other device kinds are rejected"
- `disconnect device` — "when its current transport permits disconnection"
- `set/toggle listening mode` — "rejected for unsupported or disconnected devices"
- `set/toggle spatial audio mode` — "rejected when the current route does not support Spatial Audio"
- `show status window` — "for a live device" (was just "a device")
- `configure/set battery alert commands` — "for a known device that supports battery alerts" (was
  just "a device") — implies these might now also work on OFFLINE known devices, not just live ones.
  Verify.
- `delete battery alerts` — NOW SAYS: "disabled default alert records remain available and can be
  configured again." **THIS DIRECTLY ANSWERS THE OPEN QUESTION IN THE CURRENT DOC/CODE** — deletion
  is safe/reversible now. The v1 decision to omit delete-battery-alerts UI (`docs/solutions/` +
  `battery-alerts.tsx` comments) was explicitly because this was unknown. Re-evaluate: deletion may
  now be safe to expose. Read the current `battery-alerts.tsx` comments about why it was omitted
  before deciding.

## What this means for the current codebase — the actual work

This is close to a **rewrite of the client layer**, not a patch. The old sdef's constraints drove
almost every design decision in `src/airbuddy.ts`, `src/types.ts`, and every command file. Nearly all
of that defensive/inferential code is now either wrong, obsolete, or replaceable with something
simpler and more correct.

### Kill list — code that becomes dead or wrong

- `supportsListeningMode()` in `types.ts` — the trap it guards against (poisoned `"transparency"` on
  non-headsets) no longer exists. `listening mode` now correctly returns null/missing for
  non-applicable devices. Replace all call sites with a direct null-check, or keep the helper but
  redefine it as `device.listeningMode !== null` for compatibility with existing call sites (cheaper
  migration, same safety property, now backed by the API instead of client-side inference).
- `isConnectable()` in `types.ts` (`kind === "headset"`) — WRONG per live verification. Trackpad
  (accessory) has `"connect"` in `supportedActions`. Replace with
  `device.supportedActions.includes("connect")`.
- `isAudioDevice()` in `types.ts` (`device.outputRoute`) — check whether `supportedActions` has
  something more precise for spatial-audio eligibility, or whether `outputRoute` is still the right
  signal (spatial audio is application-level, tied to the output route, not a per-device
  capability — this one may be fine as-is, but re-verify against 911's `supported actions` list,
  which does NOT appear to include a spatial-audio-related action string in the two samples above).
- `getOutputDevice()` / `OutputDevice` type in `airbuddy.ts` — was a workaround for "how do I know
  which headset the user means when a command's target is ambiguous." May still be needed for
  application-level state (spatial audio, current route), but its ROLE in target-selection for
  listening-mode/disconnect commands should be re-evaluated now that `operation result.target id`
  tells you PRECISELY what AirBuddy actually acted on, after the fact. Possibly: dispatch first, read
  `target id` from the result, THEN decide if you need to re-poll — rather than pre-resolving a guess
  and hoping it matches.
- The entire `pollUntil()` pattern for postcondition-checking after fire-and-forget commands — may
  become unnecessary or much simpler. If `operation result` is returned SYNCHRONOUSLY with
  `outcome`/`applied`/`connected` already reflecting the final state, there may be no need to poll at
  all. **This is the single highest-value thing to verify first** — dispatch `connect device` against
  a real headset and check: does the returned `operation result.connected` reflect the TRUE final
  state, or just "request accepted"? If it's the true final state, `pollUntil` and its whole
  associated ceremony (animated-toast-before, poll-after, timeout descriptions) can be deleted from
  every command. Test this before touching anything else.
- Every command's manual "is this connectable / does this support X" pre-flight guard
  (`toggle-spatial-audio.ts`'s `currentOutputName` check, `disconnect-headset.ts`'s `kind ===
  "headset"` gating, `set-listening-mode.tsx`'s `supportedListeningModes.length === 0` check) —
  candidates to replace with `supportedActions` checks, or to remove entirely if `operation
  result.outcome === "rejected"` with a `reason` string is now a good enough UX on its own (show the
  rejection reason directly instead of pre-guessing).
- `list-devices.tsx`'s whole "AirBuddy only reports live devices" framing, the empty-state copy, the
  filter dropdown (All/Connected/Headsets) — the product now CAN show the full roster. This is a
  genuine product-shape opportunity, not just a bug fix: the list could now show ALL known devices
  (matching AirBuddy's own Devices settings panel, the ORIGINAL inspiration for this extension per
  the very first message of this whole project), with pinned/favorite as real, settable state. This
  is the single biggest opportunity in this migration and probably deserves its own section in the
  rebuilt list view. **This is likely a UI-facing decision — flag for Chris at the end**, but the
  data layer changes (using the new `devices()` shape, `pinned`, `favorite`) should happen regardless
  of exact UI treatment.

### New capabilities to consider adding (optional, don't block on these)

- `pin` / `favorite` as SETTABLE from the extension — a real "star this device" action in the list,
  finally possible. Was explicitly impossible in v1 (`FEEDBACK.md` §1, `docs/solutions/` mentions
  read-only favorite).
- `toggle microphone input`, `toggle audio input lock` — directly answers the two things
  `FEEDBACK.md` §9 asked for as "the two I actually wanted."
- `show Magic Handoff picker`, `toggle desktop widgets` — lower priority, mentioned in §9 as
  "lower-priority... listing them in case they're cheap."
- Battery alert deletion UI — see the `delete battery alerts` doc-string change above. Was
  deliberately omitted in v1; may now be safe to add given "disabled default alert records remain
  available and can be configured again."

### Known-safe / unchanged

- `battery` and `battery alert` classes — unchanged.
- Core enums (`device kind`, `listening mode`, `spatial audio mode`, `battery position`, `battery
  state`, `battery alert kind`) — unchanged.
- The injection-safety transport layer (`runJXA`, static scripts, `argv`-only value passing, the `--`
  terminator) — nothing about this changes. Keep it exactly as-is; it was never coupled to the old
  API's limitations.
- The SF Symbol icon work, the row layout (icon/name/mode-badge/battery), the listening-mode submenu
  with checkmarks — pure UI, unaffected by the API change except insofar as new sections/filters get
  added for the roster expansion above.

## Verification already done this session (don't re-derive)

- `AirBuddyHelper.version()` via JXA returns `"3.0"` (doesn't expose build number — use
  `defaults read .../Info.plist CFBundleVersion` if you need to confirm 911 vs. an older 3.0 build).
- `app.devices()` returns 26 devices live, confirmed `nearby`/`connected`/`pinned` all populated
  correctly on a mix of pinned-offline, live-connected, and unknown devices.
- `device.supportedActions()` (JXA camelCase of `supported actions`) works and returns the expected
  array shape on headset/accessory/host samples (see table above).
- `device.listeningMode()` returns JS `null` (not the string `"transparency"`) on trackpad and host —
  confirmed the poisoning bug is fixed upstream.
- `device.pinned()` reads correctly (`true` on a device known to be pinned in AirBuddy's UI).
- Did NOT yet test: `device.favorite()` write path, any `connect device` / `disconnect device` /
  `set listening mode` dispatch and its returned `operation result` shape in JXA, the new
  microphone/audio-lock/widgets/handoff commands, whether `set/toggle spatial audio mode` really
  lost their result type or that's a transcription gap.

## Execution plan on resume

1. **Re-read this file in full.** Then re-read `src/airbuddy.ts`, `src/types.ts`, and the command
   files fresh — don't trust pre-compaction memory of exact line numbers, the "verify against the
   live tree" discipline applies to your own prior work too.
2. **First and highest-value experiment:** dispatch one real command (e.g. `connect device` against a
   currently-disconnected headset, or `toggle listening mode`) via raw JXA and inspect the actual
   returned `operation result` object shape and whether its `connected`/`listening mode` fields
   reflect TRUE final state or just request-accepted state. This answers whether `pollUntil` can be
   deleted or must stay. Do this before writing any TypeScript.
3. **Rewrite `src/airbuddy.ts`**: new `OperationResult`/`OperationOutcome` types, update every command
   wrapper (`connectDevice`, `disconnectDevice`, `connectNearest`, `connectFavorite`,
   `disconnectHeadset`, `setListeningMode`, `toggleListeningMode`, `toggleSpatialAudio`) to return the
   real result shape instead of `void`. Add `pin`/`favorite` write commands if the sdef exposes them
   as settable properties (it does — property `access="rw"`, so it's a `set the pinned of device X to
   true` style AppleScript property-set, not a distinct command — confirm the JXA property-set
   syntax works, e.g. `device.pinned = true` or `device.pinned.set(true)`, test both).
4. **Rewrite `src/types.ts`**: update `Device` interface with `pinned`, `favorite`, `supportedActions`
   fields; fix `listeningMode` to be `ListeningMode | null`; delete or redefine
   `supportsListeningMode()`; replace `isConnectable()`/`isAudioDevice()` with `supportedActions`
   checks.
5. **Rewrite every command file** (`toggle-listening-mode.ts`, `set-listening-mode.tsx`,
   `disconnect-headset.ts`, `connect-nearest-headset.ts`, `connect-favorite-headset.ts`,
   `toggle-spatial-audio.ts`, `device-actions.tsx`) to use `operation result` for
   success/failure/reason instead of the poll-and-guess pattern, IF step 2 confirms results are
   synchronous-final-state. Update toasts to show `reason` on rejection instead of generic messages.
6. **Re-evaluate `list-devices.tsx`** — data layer at minimum should handle the full 26-device roster
   sanely (don't just dump 26 devices with no distinction between live/known-offline — that's a UX
   regression even though it's a data-availability win). Minimum bar: keep showing live/nearby
   devices prominently, but the "no way to see the roster" empty-state copy and FEEDBACK.md-derived
   framing throughout is now wrong and must be corrected at least in comments/docs even if the UI
   default stays live-first. Full "show pinned/known devices too" is the UI-facing question to save
   for Chris.
7. **Update `FEEDBACK.md`** — don't delete it, but add a note at the top: "Addressed in 911, see
   ReleaseNotes_3.0_911.md" and cross out/annotate which sections were fixed. This is Chris's ongoing
   correspondence record with Gui; don't destroy the history.
8. **Run `ce-compound-refresh` on `docs/solutions/`** — the one existing learning doc
   (`ambiguous-target-selection-in-unordered-collections.md`) documents a workaround for a problem
   the new API partially obsoletes (target ambiguity may be much less of an issue if `operation
   result.target id` tells you what actually happened). This is exactly the "Replace" case the skill
   describes: don't delete the learning (the PATTERN — prefer singular accessors over unordered
   arrays, don't guess a bare command's target — is still generally true and still applies to
   `connect to nearest/favorite headset` which remain optional-target), but update it to reflect that
   the specific incident's WORST failure mode (silent false-negative polls) is now also mitigated by
   `operation result.target id` as a second line of defense.
9. **All gates before considering anything done**: `npx tsc --noEmit`, `npx eslint src/` (0
   warnings), `npm run build`, AND hands-on verification against real hardware for at least: connect
   a headset, disconnect a headset, toggle listening mode, view the full device roster if that UI
   ships. Chris's standing rule: never claim "done" without pasted raw command output, never say
   "should work."
10. **Sync to both the standalone mirror (`main`, fast-forward + push) and the
    `chrismessina/extensions:add-airbuddy` fork branch** (copy the allow-listed file set — see
    `docs/superpowers/plans/2026-07-13-airbuddy-extension.md` "What ships" section and
    `~/Developer/GitHub/chrismessina/raycast-extension-workflows/plugins/raycast-extensions/reference/my-extensions-mirror.md`
    for the exact procedure already used twice this session), then push to update the open draft PR
    ([raycast/extensions#29448](https://github.com/raycast/extensions/pull/29448)). The monorepo
    sparse-checkout already exists at `/Users/messina/Developer/GitHub/chrismessina/monorepo-airbuddy`
    — don't re-clone, just sync files and commit again on the existing `add-airbuddy` branch.
11. **Save every UI/UX-facing decision for one batch of questions at the end.** Candidates already
    identified above: (a) whether to show the full known/pinned roster in the list view or keep it
    live-only with roster as a future filter option, (b) whether to add pin/favorite as a settable
    action in the UI now that it's possible, (c) whether to add the new mic/audio-lock/widgets/handoff
    commands as new no-view commands, (d) whether to add battery-alert deletion UI now that it's
    documented as reversible. Everything else — types, error handling, removing dead code, the
    result-shape plumbing — is Chris's explicit "you can handle all of it."

## Things NOT to do

- Don't touch `.gitignore`, `CHANGELOG.md`, or anything already fixed in the last review round unless
  this migration specifically requires it.
- Don't re-litigate the SF Symbol icon work, the row layout, or the checkmark-in-submenu UI — those
  are done and approved, orthogonal to this API migration.
- Don't delete `FEEDBACK.md`'s history — annotate, don't destroy.
- Don't skip the "verify against real hardware" discipline just because the sdef prose is detailed
  and convincing — that discipline is *why* this project's reviews kept finding bugs the sdef alone
  wouldn't reveal (e.g., a trackpad answering a listening-mode query at all was never going to be
  obvious from reading a dictionary file).

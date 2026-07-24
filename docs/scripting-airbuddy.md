# AirBuddy AppleScript Examples

> Upstream reference from AirBuddy's author (Gui Rambo), originally current as of AirBuddyHelper
> build 912; see the "[Corrected for build 913]" note below for the one thing that changed since.
> This is the general AppleScript/JXA dictionary reference for scripting AirBuddy — it is not
> specific to this extension. For where these calls are actually used in this codebase, see
> [`src/airbuddy.ts`](../src/airbuddy.ts), which wraps every command as a static JXA script run via
> `osascript -l JavaScript` (see `runJXA()`), never native AppleScript. If you're extending this
> extension with a new AirBuddy capability, this doc is the dictionary; `src/airbuddy.ts` is the
> pattern to follow for wiring it in (static script + serialized `argv`, never interpolated values —
> see the SECURITY note on `runJXA`).

This document contains practical AppleScript examples for automating AirBuddy.

The examples start with read-only queries, then move into filtering, UI presentation,
device actions, listening and spatial audio controls, and battery alert management.

Most scripts are intended to be run from Script Editor, Shortcuts, Automator, shell
scripts using `osascript`, or other AppleScript-capable automation tools.

## Basics

All examples target `AirBuddyHelper`, because the helper owns AirBuddy's device state
and automation commands.

```applescript
tell application "AirBuddyHelper"
    -- AirBuddy commands go here
end tell
```

AirBuddy exposes one `device` per non-ignored device in its known-device roster,
including pinned or favorite devices that are currently offline. When a known device
is live, its current data replaces the stored snapshot. The `nearby` property tells
you whether a device is currently present in AirBuddy's live feed.

For scripts that only need references to currently available devices, use `live devices`
instead. It returns only the current live feed and does not enumerate the stored offline
roster. Use `get live devices` to materialize that snapshot before iterating or counting
it.

For high-frequency polling that reads several fields from every live device, use `live
device snapshots`. It returns compact, read-only value records with each device's
metadata, state, route, listening-mode, preference, action, bud/case, and battery values
and battery-alert configurations in one response. Retrieve a new snapshot list when the
script needs refreshed data.

Batteries are nested under devices as `battery` elements. Battery alert configurations
are nested under devices as `battery alert` elements.

Battery levels and alert thresholds are percentages from `0` to `100`.

Some commands can accept any of these as a device reference, in this preferred order:

- a device `id`
- a `device` object
- a Bluetooth `address`
- a unique device `name`

Use `id` for durable integrations. IDs are stable across user-visible renames and avoid
ambiguity when multiple devices have the same name. A `device` object is convenient
within a single script invocation. Bluetooth addresses are useful for Classic
accessories. Name lookup is a convenience and the name must uniquely identify one
device.

The `nearest headset` and `favorite headset` accessors may resolve an offline device
before it appears as `nearby`. After connecting one of these accessors, poll that same
accessor by `id`; do not assume that it will immediately join the live feed.

AirBuddy's own scripting switch is at **AirBuddy Settings → General → Security →
Enable Apple Script for automation**. When this switch is off, AirBuddy returns the
stable application error `-10001`. A macOS Automation permission denial remains
Apple-event error `-1743`, so clients do not need to distinguish the states by parsing
localized prose.

When iterating over AirBuddy collections, use `get` to turn the application
object specifier into a list value before entering the loop:

```applescript
repeat with deviceRef in (get devices)
    set d to contents of deviceRef
end repeat
```

## Read Device Information

### Count Known Devices

```applescript
tell application "AirBuddyHelper"
    count devices
end tell
```

### List Live Devices

Use `live devices` when a script only needs devices currently available to AirBuddy.
Unlike `devices`, it avoids loading the complete known-device roster.

```applescript
tell application "AirBuddyHelper"
    set liveDeviceRefs to get live devices
    set liveNames to {}

    repeat with deviceRef in liveDeviceRefs
        set d to contents of deviceRef
        set end of liveNames to name of d
    end repeat

    liveNames
end tell
```

### Read Live Device Snapshots Efficiently

Use `live device snapshots` when a script needs several values from each live device.
Unlike `live devices`, it returns plain value records rather than device and battery
references, so AirBuddy can return all of the requested fields in one Apple-event
response. A device snapshot includes the read-only values used in the JXA example below:
identity and metadata, connection/route/audio/listening state, pin/favorite/action state,
bud/case state, and nested battery values. A battery snapshot includes `position`,
`level`, `charging state`, `low`, and `unreliable`. A battery alert snapshot includes
`kind`, `position`, `threshold`, and `enabled`.

This API remains live-only. Use `live device snapshots` when the script only needs
devices in AirBuddy's current live feed; it does not replace the complete `devices`
roster for scripts that also need stored offline devices.

```applescript
tell application "AirBuddyHelper"
    set snapshotRefs to get live device snapshots
    set rows to {}

    repeat with snapshotRef in snapshotRefs
        set snapshot to contents of snapshotRef
        set batteryRows to {}

        repeat with batterySnapshotRef in (battery snapshots of snapshot)
            set batterySnapshot to contents of batterySnapshotRef
            set end of batteryRows to {¬
                position:position of batterySnapshot, ¬
                level:level of batterySnapshot, ¬
                chargingState:charging state of batterySnapshot}
        end repeat

        set alertRows to {}
        repeat with alertSnapshotRef in (battery alert snapshots of snapshot)
            set alertSnapshot to contents of alertSnapshotRef
            set end of alertRows to {¬
                kind:kind of alertSnapshot, ¬
                position:position of alertSnapshot, ¬
                threshold:threshold of alertSnapshot, ¬
                enabled:enabled of alertSnapshot}
        end repeat

        set end of rows to {¬
            deviceID:id of snapshot, ¬
            deviceName:name of snapshot, ¬
            isNearby:nearby of snapshot, ¬
            availableActions:supported actions of snapshot, ¬
            batteries:batteryRows, ¬
            alerts:alertRows}
    end repeat

    return rows
end tell
```

### List Device Names

```applescript
tell application "AirBuddyHelper"
    name of every device
end tell
```

### List Device Names and Kinds

```applescript
tell application "AirBuddyHelper"
    set rows to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        set end of rows to (name of d) & " - " & ((kind of d) as text)
    end repeat

    rows
end tell
```

### Inspect the First Device

```applescript
tell application "AirBuddyHelper"
    set d to first device

    return {deviceID:id of d, name:name of d, deviceKind:kind of d, model:model of d, brand:brand of d, bluetoothAddress:address of d, isConnected:connected of d, isNearby:nearby of d, isPinned:pinned of d, isFavorite:favorite of d, availableActions:supported actions of d, lastUpdated:updated at of d}
end tell
```

### Read and Change Pin or Favorite State

`pinned` can be changed for stored devices other than This Mac. Only a headset can be
made `favorite`, and AirBuddy supports one favorite headset at a time.

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set d to device id targetID
    set pinned of d to true

    if kind of d is headset then
        set favorite of d to true
    end if
end tell
```

### Read Currently Available Actions

`supported actions` contains stable text identifiers such as `connect`, `disconnect`,
`set listening mode`, `toggle spatial audio mode`, and `show device menu`. The list is
dynamic: connection and audio-route changes can change it.

```applescript
tell application "AirBuddyHelper"
    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        log {id of d, supported actions of d}
    end repeat
end tell
```

### Find Nearby Devices

```applescript
tell application "AirBuddyHelper"
    set nearbyDevices to {}

    repeat with deviceRef in (get live devices)
        set d to contents of deviceRef
        if nearby of d then
            set end of nearbyDevices to name of d
        end if
    end repeat

    nearbyDevices
end tell
```

### Find Connected Devices

```applescript
tell application "AirBuddyHelper"
    set connectedDevices to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        if connected of d then
            set end of connectedDevices to name of d
        end if
    end repeat

    connectedDevices
end tell
```

### Read the Current Audio Routes

```applescript
tell application "AirBuddyHelper"
    set outputName to "No AirBuddy output route"
    set inputName to "No AirBuddy input route"

    if the current output device is not missing value then
        set outputName to name of the current output device
    end if

    if the current input device is not missing value then
        set inputName to name of the current input device
    end if

    return "Output: " & outputName & return & "Input: " & inputName
end tell
```

### Read the Nearest and Favorite Headsets

```applescript
tell application "AirBuddyHelper"
    set nearestName to "No headset resolved"
    set favoriteName to "Favorite headset not available"

    if the nearest headset is not missing value then
        set nearestName to name of the nearest headset
    end if

    if the favorite headset is not missing value then
        set favoriteName to name of the favorite headset
    end if

    return "Nearest: " & nearestName & return & "Favorite: " & favoriteName
end tell
```

## Read Battery Information

### List Batteries for Every Device

```applescript
tell application "AirBuddyHelper"
    set reportLines to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        repeat with batteryRef in (get batteries of d)
            set b to contents of batteryRef
            set end of reportLines to (name of d) & " - " & ((position of b) as text) & ": " & ((round (get level of b)) as text) & "%"
        end repeat
    end repeat

    reportLines
end tell
```

### Show Battery Details for One Device

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return "No headset resolved"

    set details to {}

    repeat with batteryRef in (get batteries of d)
        set b to contents of batteryRef
        set end of details to {part:position of b, charge:get level of b, state:charging state of b, isLow:low of b, unreliable:unreliable of b}
    end repeat

    details
end tell
```

### Find Low Batteries

```applescript
tell application "AirBuddyHelper"
    set lowBatteryLines to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        repeat with batteryRef in (get batteries of d)
            set b to contents of batteryRef
            if low of b then
                set end of lowBatteryLines to (name of d) & " " & ((position of b) as text) & " is low: " & ((round (get level of b)) as text) & "%"
            end if
        end repeat
    end repeat

    lowBatteryLines
end tell
```

### Notify When Any Battery Is Below 20 Percent

```applescript
tell application "AirBuddyHelper"
    set notificationLines to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        repeat with batteryRef in (get batteries of d)
            set b to contents of batteryRef
            if (get level of b) is less than 20 then
                set end of notificationLines to (name of d) & " " & ((position of b) as text) & ": " & ((round (get level of b)) as text) & "%"
            end if
        end repeat
    end repeat
end tell

if notificationLines is not {} then
    set AppleScript's text item delimiters to linefeed
    set bodyText to notificationLines as text
    set AppleScript's text item delimiters to ""

    display notification bodyText with title "Low Wireless Device Battery"
end if
```

## Show AirBuddy UI

### Show the Device List

```applescript
tell application "AirBuddyHelper"
    show devices
end tell
```

### Show the Status Window for the Best Nearby Headset

```applescript
tell application "AirBuddyHelper"
    show status window
end tell
```

### Show the Status Window for a Specific Device

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    show status window targetID
end tell
```

### Show the Device Menu for the Nearest Headset

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset
    if d is missing value then return "No headset resolved"

    set a to the address of d
    show device menu a
end tell
```

### Show Battery Alert Settings for the Favorite Headset

```applescript
tell application "AirBuddyHelper"
    set d to the favorite headset
    if d is not missing value then
        configure battery alerts (id of d)
    end if
end tell
```

## Connect and Disconnect Devices

Connect, disconnect, and listening-mode commands wait for the underlying operation and
return an `operation result` record:

- `outcome`: `applied`, `rejected`, `failed`, or `cancelled`
- `applied`: `true` only when the operation completed successfully
- `target id`: the stable ID of the device AirBuddy actually resolved, or `missing value` when no target could be resolved
- `reason`: the rejection or failure reason, otherwise `missing value`
- `connected`: the resulting connection state, or `missing value` when it does not apply
- `listening mode`: the resulting mode, or `missing value` when it does not apply

`rejected` means the operation could not apply to the target or its current state. It
is not a transport failure and should not be retried until `supported actions` changes.
`failed` means the operation was applicable but the underlying Bluetooth or audio
operation did not complete.

### Connect to the Favorite Headset

```applescript
tell application "AirBuddyHelper"
    connect to favorite headset
end tell
```

### Connect to the Nearest Headset

```applescript
tell application "AirBuddyHelper"
    connect to nearest headset
end tell
```

### Connect to a Device by ID and Check the Result

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set result to connect device targetID

    if applied of result then
        return "Connected " & (target id of result)
    else
        return ((outcome of result) as text) & ": " & (reason of result)
    end if
end tell
```

To discover IDs, enumerate `id of every device` or read the `id` from a selected
`device` object. Name-based lookup remains available for one-off scripts:

```applescript
tell application "AirBuddyHelper" to connect device "My AirPods Pro"
```

### Connect and Set Transparency Mode

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    connect device targetID listening mode transparency
end tell
```

### Connect with the Microphone Enabled

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    connect device targetID listening mode noise cancellation microphone enabled true
end tell
```

### Connect a Paired Bluetooth Accessory

`connect device` and `disconnect device` support headsets and paired generic Bluetooth
accessories such as a Magic Mouse, Keyboard, or Trackpad. Listening-mode and microphone
parameters are headset-only. Mobile devices, Macs, unpaired accessories, and USB-connected
accessories that cannot be disconnected return `rejected` with a reason.

```applescript
set mouseID to "REPLACE_WITH_MAGIC_MOUSE_ID"

tell application "AirBuddyHelper"
    set result to connect device mouseID
    return {outcome of result, target id of result, connected of result}
end tell
```

### Connect to the Nearest Headset Object

```applescript
tell application "AirBuddyHelper"
    set targetDevice to the nearest headset

    if targetDevice is not missing value then
        connect device targetDevice listening mode transparency
    end if
end tell
```

### Disconnect a Specific Device

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set result to disconnect device targetID
    return {outcome of result, target id of result, connected of result}
end tell
```

### Disconnect the Current Output Device

```applescript
tell application "AirBuddyHelper"
    if the current output device is not missing value then
        disconnect device (the current output device)
    end if
end tell
```

### Cancel a Pending Connection

```applescript
tell application "AirBuddyHelper"
    cancel device connection
end tell
```

### Cancel a Pending Headset Connection for a Specific Device

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    cancel device connection targetID
end tell
```

Cancellation applies to AirBuddy's headset connection pipeline. Generic accessory
connections use the Bluetooth Classic operation directly and cannot be cancelled by
this command.

## Listening Mode Automation

### Read the Current Listening Mode

`listening mode` is `missing value` when the device has no supported listening modes.
Check `supported listening modes` or `supported actions` before showing controls.

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return "No headset resolved"

    listening mode of d
end tell
```

### List Supported Listening Modes

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return "No headset resolved"

    supported listening modes of d
end tell
```

### Set Noise Cancellation for a Device

The parentheses around `nearest headset` avoid an AppleScript grammar ambiguity
between the `device` command parameter and the `device` class name.

```applescript
tell application "AirBuddyHelper"
    if the nearest headset is not missing value then
        set result to set listening mode noise cancellation device (the nearest headset)
        return {outcome of result, target id of result, listening mode of result}
    end if
end tell
```

### Set Transparency on the Current Output Device

```applescript
tell application "AirBuddyHelper"
    if the current output device is not missing value then
        set result to set listening mode transparency device (the current output device)
        return {outcome of result, target id of result, listening mode of result}
    end if
end tell
```

### Toggle Listening Mode

```applescript
tell application "AirBuddyHelper"
    toggle listening mode
end tell
```

### Toggle Listening Mode for a Specific Device ID

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set result to toggle listening mode targetID
    return {outcome of result, target id of result, listening mode of result}
end tell
```

The `listening mode` property is read-only. Use `set listening mode` so the script gets
the completed operation result instead of losing asynchronous errors.

## Spatial Audio Automation

### Read Spatial Audio Mode

```applescript
tell application "AirBuddyHelper"
    spatial audio mode
end tell
```

### Turn Spatial Audio Off

```applescript
tell application "AirBuddyHelper"
    set spatial audio mode off
end tell
```

### Set Fixed Spatial Audio

```applescript
tell application "AirBuddyHelper"
    set spatial audio mode fixed
end tell
```

### Set Head Tracked Spatial Audio

```applescript
tell application "AirBuddyHelper"
    set spatial audio mode head tracked
end tell
```

### Toggle Spatial Audio

```applescript
tell application "AirBuddyHelper"
    toggle spatial audio mode
end tell
```

Spatial Audio is an application/output-route setting. Both set and toggle commands act
only on the current output route and reject the command if there is no route or the
route does not support Spatial Audio. There is intentionally no device parameter.

### Use a Property Assignment to Change Spatial Audio

```applescript
tell application "AirBuddyHelper"
    set the spatial audio mode to fixed
end tell
```

## Additional AirBuddy Actions

These commands invoke the same actions exposed by AirBuddy's keyboard-shortcut menu.
They return after the UI action is dispatched; they do not return an `operation result`.

```applescript
tell application "AirBuddyHelper"
    toggle microphone input
    toggle audio input lock
    toggle desktop widgets floating
    show Magic Handoff picker
end tell
```

> **[Corrected for build 913]** `toggle desktop widgets` was renamed to `toggle desktop widgets
floating` — per Gui, "to make it consistent with what's actually being controlled and with the
> new readable property" (`desktop widgets floating`, on `application`). Build 913 also added a
> readable `audio input lock enabled` property. Both are now pollable postconditions in this
> extension; see `src/airbuddy.ts`'s `AppState`.

`toggle microphone input` requires a currently routed headset and otherwise returns a
scripting error. `show Magic Handoff picker` only presents the picker; it does not
perform an unattended transfer. AppleScript does not currently expose Now Playing
metadata, full Desktop Widget configuration, or direct Magic Handoff transfers.

## Battery Alert Automation

AirBuddy exposes supported low-battery and charged alert records even before the user
configures them. These pre-seeded records are disabled and carry AirBuddy's default
thresholds, so clients can inspect and edit existing records instead of creating new
elements.

### Read Existing Battery Alerts

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return "No headset resolved"

    set alertRows to {}

    repeat with alertRef in (get battery alerts of d)
        set alertConfig to contents of alertRef
        set end of alertRows to {alertKind:kind of alertConfig, part:position of alertConfig, alertThreshold:get threshold of alertConfig, isEnabled:enabled of alertConfig}
    end repeat

    alertRows
end tell
```

### Enable a Low Battery Alert for Earbuds

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set low battery alert targetID threshold 20 part left bud enabled true
end tell
```

For multipart headsets, AirBuddy uses the same main/bud convention as the setup UI:
if there is no `main` battery part, bud alerts are stored through the left bud entry
and applied using AirBuddy's existing multipart alert rules.

### Enable a Charged Alert for the Charging Case

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set charged battery alert targetID threshold 90 part charging case enabled true
end tell
```

### Disable a Low Battery Alert Without Changing Its Threshold

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    set low battery alert targetID threshold 20 part left bud enabled false
end tell
```

### Delete Battery Alerts for a Device

```applescript
set targetID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    delete battery alerts targetID
end tell
```

Deletion is a reversible reset. It removes the stored configuration, after which
AirBuddy immediately exposes the supported pre-seeded records again with default
thresholds and `enabled: false`. A later `set low battery alert` or
`set charged battery alert` command recreates the stored configuration.

### Configure Alerts for the Favorite Headset

```applescript
tell application "AirBuddyHelper"
    if the favorite headset is not missing value then
        set low battery alert (the favorite headset) threshold 25 part left bud enabled true
        set charged battery alert (the favorite headset) threshold 90 part charging case enabled true
    end if
end tell
```

## Practical Workflows

### Show the Status Window Only When a Nearby Headset Exists

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset
    if d is not missing value and nearby of d then
        show status window (id of d)
    else
        display notification "No nearby headset found." with title "AirBuddy"
    end if
end tell
```

### Connect to the Best Headset Before a Meeting

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then
        display notification "AirBuddy could not resolve a headset." with title "AirBuddy"
        return
    end if

    return connect device d listening mode noise cancellation microphone enabled true
end tell
```

### Switch to Focus Mode

This connects to the nearest headset, enables noise cancellation, and sets fixed
Spatial Audio.

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return "No headset resolved"

    set result to connect device d listening mode noise cancellation microphone enabled false
    if applied of result then set spatial audio mode fixed
    return result
end tell
```

### Switch to Conversation Mode

```applescript
tell application "AirBuddyHelper"
    set d to the current output device

    if d is missing value then
        set d to the nearest headset
    end if

    if d is missing value then return "No headset available"

    set listening mode transparency device (d)
    set spatial audio mode off
end tell
```

### Warn Before Leaving With Low Batteries

Use this from a shortcut or automation before leaving your desk.

```applescript
tell application "AirBuddyHelper"
    set warningLines to {}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        if nearby of d then
            repeat with batteryRef in (get batteries of d)
                set b to contents of batteryRef
                if (get level of b) is less than 30 then
                    set end of warningLines to (name of d) & " " & ((position of b) as text) & ": " & ((round (get level of b)) as text) & "%"
                end if
            end repeat
        end if
    end repeat
end tell

if warningLines is {} then
    display notification "Nearby wireless devices look charged." with title "AirBuddy"
else
    set AppleScript's text item delimiters to linefeed
    set warningText to warningLines as text
    set AppleScript's text item delimiters to ""

    display dialog warningText with title "Low Wireless Device Batteries" buttons {"OK"} default button "OK"
end if
```

### Build a Markdown Battery Report

```applescript
tell application "AirBuddyHelper"
    set reportLines to {"# AirBuddy Battery Report", ""}

    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        set end of reportLines to "## " & (name of d)
        set end of reportLines to ""
        set end of reportLines to "- Kind: " & ((kind of d) as text)
        set end of reportLines to "- Connected: " & ((connected of d) as text)
        set end of reportLines to "- Nearby: " & ((nearby of d) as text)
        set end of reportLines to "- Updated: " & ((updated at of d) as text)
        set end of reportLines to ""

        repeat with batteryRef in (get batteries of d)
            set b to contents of batteryRef
            set end of reportLines to "- " & ((position of b) as text) & ": " & ((round (get level of b)) as text) & "% (" & ((charging state of b) as text) & ")"
        end repeat

        set end of reportLines to ""
    end repeat
end tell

set AppleScript's text item delimiters to linefeed
set markdownReport to reportLines as text
set AppleScript's text item delimiters to ""

markdownReport
```

### Connect by Stored Device ID

Device names can change. For long-lived automations, store the `id` of a device and
use that instead.

```applescript
set airPodsID to "REPLACE_WITH_DEVICE_ID"

tell application "AirBuddyHelper"
    connect device airPodsID listening mode noise cancellation
end tell
```

To get the id:

```applescript
tell application "AirBuddyHelper"
    id of the nearest headset
end tell
```

### Connect by Bluetooth Address

```applescript
set airPodsAddress to "AA:BB:CC:DD:EE:FF"

tell application "AirBuddyHelper"
    connect device airPodsAddress listening mode transparency
end tell
```

### Keep Spatial Audio Off for Calls

This example assumes it is triggered by a separate automation when you join a call.

```applescript
tell application "AirBuddyHelper"
    if the current output device is not missing value then
        set spatial audio mode off
        set listening mode transparency device (the current output device)
    end if
end tell
```

### Open AirBuddy UI When a Device Is Nearby but Not Connected

```applescript
tell application "AirBuddyHelper"
    set d to the nearest headset

    if d is missing value then return

    if nearby of d and connected of d is false then
        set targetID to id of d
        show status window targetID
    end if
end tell
```

### Maintain Battery Alerts for All Nearby Headsets

```applescript
tell application "AirBuddyHelper"
    repeat with deviceRef in (get devices)
        set d to contents of deviceRef
        if kind of d is headset and nearby of d then
            set low battery alert d threshold 25 part left bud enabled true
            set charged battery alert d threshold 90 part charging case enabled true
        end if
    end repeat
end tell
```

## Running Examples from the Shell

Use `osascript` for short scripts:

```sh
osascript -e 'tell application "AirBuddyHelper" to name of every device'
```

For longer scripts, save the AppleScript to a file and run:

```sh
osascript ~/Scripts/AirBuddyBatteryReport.applescript
```

JXA uses the same dictionary and avoids AppleScript's `device` parameter/class grammar
ambiguity. Scripting terms become JavaScript-style names. Use `liveDeviceSnapshots()`
for high-frequency polling or when the script needs several values for each device:

```javascript
function run() {
  const app = Application("AirBuddyHelper");
  const out = [];

  for (const d of app.liveDeviceSnapshots()) {
    const rec = {
      id: d.id,
      name: d.name,
      kind: d.kind,
      model: d.model,
      brand: d.brand,
      address: d.address,
      connected: d.connected,
      nearby: d.nearby,
      distance: d.distance,
      source: d.source,
      audioState: d.audioState,
      inputRoute: d.inputRoute,
      outputRoute: d.outputRoute,
      listeningMode: d.listeningMode,
      supportedListeningModes: d.supportedListeningModes,
      pinned: d.pinned,
      favorite: d.favorite,
      supportedActions: d.supportedActions,
      leftBudInEar: d.leftBudInEar,
      rightBudInEar: d.rightBudInEar,
      anyBudInEar: d.anyBudInEar,
      anyBudInCase: d.anyBudInCase,
      caseLidClosed: d.caseLidClosed,
      batteries: d.batterySnapshots.map(function (b) {
        return {
          position: b.position,
          level: b.level,
          chargingState: b.chargingState,
          low: b.low,
          unreliable: b.unreliable,
        };
      }),
      alerts: d.batteryAlertSnapshots.map(function (a) {
        return {
          kind: a.kind,
          position: a.position,
          threshold: a.threshold,
          enabled: a.enabled,
        };
      }),
    };
    out.push(rec);
  }

  return JSON.stringify(out);
}
```

Snapshot fields are ordinary JavaScript values, so use `snapshot.id` rather than
`snapshot.id()`. Use `liveDevices()` when the script specifically needs device objects
for follow-up commands or properties that snapshots do not include. `listeningMode` is
`null` in JXA when listening modes do not apply to that device.

## Notes and Caveats

- `devices` is the complete known roster. `live devices` and `live device snapshots`
  contain only the current live feed and avoid loading stored offline devices. `live
device snapshots` is the efficient choice when several values are needed for each
  device; retrieve it again to refresh its values. `nearby`, connection state, route
  state, supported actions, batteries, and sensor properties are dynamic and can change
  over time.
- Audio route getters only return a value when a headset known by AirBuddy is the current route; pure audio devices that are not backed by an AirBuddy device are not currently available for scripts.
- Connect, disconnect, and set/toggle listening-mode commands return after the operation
  completes. Other UI-oriented commands return after AirBuddy dispatches the action.
- Device name resolution must be unique. Use `id` or `address` for durable automations.
- `listening mode` is `missing value` when listening modes do not apply. Use
  `supported listening modes` and `supported actions` to decide which controls to show.
- For a wired Classic accessory, `charging state` reports `charging` while its battery
  is actively charging and `AC power` while USB power is present but the battery is not
  charging, including when it is full. `discharging` indicates that AirBuddy sees it as
  battery-powered rather than USB-powered.
- `charge time remaining` and `battery time remaining` are usually unavailable (`-1`)
  for headsets, mobile devices, and accessories. AirBuddy populates them for This Mac or
  a UPS only when macOS's power-source APIs provide an estimate.
- `distance` is derived from BLE proximity-pairing data and is most commonly available
  for nearby headsets. It is normally `unknown` for Classic accessories, Macs, mobile
  devices, and offline stored snapshots; `nearby` does not imply a distance estimate.
- AirBuddy prefers SF Symbols for device glyphs and falls back to its bundled custom PDF
  artwork when no suitable public symbol exists. The Magic Trackpad glyph is one of
  those custom assets; there is no public `magictrackpad` SF Symbol to reuse.
- `tell application "AirBuddyHelper" to quit` is interactive. AirBuddy presents its
  confirmation UI and the script waits for the user's decision.
- Battery alert commands use AirBuddy's existing capability rules. Read the pre-seeded
  alert records and their positions before changing multipart device configurations.
- Setting `pinned` or `favorite`, and commands that do not return an operation record,
  raise an AppleScript error when the requested action is not applicable. Check
  `supported actions` first when presenting device controls.

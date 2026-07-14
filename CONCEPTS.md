# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with
project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and
ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Devices

### Device
An entry in AirBuddy's live device collection — a Bluetooth or wired accessory AirBuddy currently sees.
Kinds are headset, mobile, accessory, host, or Mac. The collection is **unordered**: array position
carries no meaning about which device is currently active or most relevant. This distinguishes a Device
from the Output Route, which is a singular, unambiguous pointer rather than a member of an unordered set.

### Output Route
The one device currently serving as the active audio output — a singular property, not a member of the
Device collection. Because it is singular rather than an unordered array entry, it is the correct way to
answer "which device does the user mean right now," where picking a Device by array position is not.
The Output Route can resolve to *any* device kind, including the host Mac itself when its built-in
speakers are active — it is not guaranteed to be a headset.
*Avoid:* "current device," "active device" — use Output Route.

### Headset Handle
A singular accessor (distinct from scanning the Device collection) that can resolve to a headset the
Device collection does not currently include — for example, a favorited or nearest headset that is
present but not actively connected. Like the Output Route, a Headset Handle answers "which device" without
relying on array position, but it answers a different question (favorited/nearest vs. currently active).

## Flagged ambiguities

- A device can be present as a Headset Handle (e.g. "the favorite") without being reachable through the
  Device collection at all — the two are not interchangeable ways of listing the same devices.

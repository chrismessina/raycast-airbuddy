import { Toast, showToast } from "@raycast/api";
import { disconnectDevice, getDevices, getOutputDevice } from "./airbuddy";
import { failToast, showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Disconnecting headset…" });

  try {
    // Use `disconnect device` with an explicit id — NOT the bare `disconnect headset`.
    //
    // `disconnect headset` disconnects "THE headset that's currently connected" (sdef, singular) and
    // picks its own target opaquely. With two headsets connected, we cannot know which one it chose:
    //   - polling "zero headsets remain" times out (it only disconnects one)
    //   - polling a headset WE picked from devices() is a coin flip — that collection has no
    //     documented ordering, so we may poll the Beats while AirBuddy disconnected the AirPods
    // Both are false failures on a disconnect that actually worked.
    //
    // The output route is the honest answer to "the headset", and `disconnect device` lets us name
    // it. No guessing, and the poll can't disagree with what AirBuddy did.
    const output = await getOutputDevice();

    // Fall back to any connected headset if there's no output route (e.g. connected but not routed).
    const fallback = output ? null : (await getDevices()).find((d) => d.kind === "headset" && d.connected);
    const target = output ?? fallback;

    if (!target) {
      failToast(toast, "No headset connected", "There's nothing to disconnect.");
      return;
    }

    // Re-bind: TS does not carry the guard above into the closure below.
    const targetId: string = target.id;
    const targetName: string = target.name;

    toast.title = `Disconnecting ${targetName}…`;

    await disconnectDevice(targetId);

    await pollUntil(
      () => getDevices(),
      (devices) => devices.find((d) => d.id === targetId)?.connected !== true,
      { description: `${targetName} never disconnected` },
    );

    toast.style = Toast.Style.Success;
    toast.title = `Disconnected ${targetName}`;
  } catch (error) {
    await showFailure("Couldn't disconnect the headset", error);
  }
}

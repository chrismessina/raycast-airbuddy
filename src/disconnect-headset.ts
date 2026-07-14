import { Toast, showToast } from "@raycast/api";
import { disconnectHeadset, getDevices } from "./airbuddy";
import { failToast, showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Disconnecting headset…" });

  try {
    // Check FIRST. The naive postcondition ("no headset is connected") is ALREADY TRUE when no
    // headset was connected to begin with — so polling it blind returns on the first read and
    // reports a green "Headset disconnected" for a disconnect that never happened. AirBuddy
    // accepts the command and silently no-ops it, so there is no error to catch either. Verified.
    const before = await getDevices();
    const connected = before.find((d) => d.kind === "headset" && d.connected);

    if (!connected) {
      failToast(toast, "No headset connected", "There's nothing to disconnect.");
      return;
    }

    // Re-bind: TS does not carry the check above into the closure below.
    const targetId: string = connected.id;
    const targetName: string = connected.name;

    await disconnectHeadset();

    // Poll THIS headset, not "zero headsets remain". `disconnect headset` disconnects *the*
    // connected headset (singular, per the sdef). With two headsets connected, requiring both to
    // vanish spins to timeout and reports failure for a disconnect that actually succeeded.
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

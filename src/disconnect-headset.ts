import { Toast, showToast } from "@raycast/api";
import { disconnectHeadset, getDevices } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Disconnecting headset…" });

  try {
    // Check FIRST. The postcondition below ("no headset is connected") is ALREADY TRUE when no
    // headset was connected to begin with — so polling it blind returns on the first read and
    // reports a green "Headset disconnected" for a disconnect that never happened. AirBuddy
    // accepts the command and silently no-ops it, so there is no error to catch either. Verified.
    const before = await getDevices();
    const connected = before.find((d) => d.kind === "headset" && d.connected);

    if (!connected) {
      toast.style = Toast.Style.Failure;
      toast.title = "No headset connected";
      toast.message = "There's nothing to disconnect.";
      return;
    }

    const target: string = connected.name;

    await disconnectHeadset();
    await pollUntil(
      () => getDevices(),
      (devices) => !devices.some((d) => d.kind === "headset" && d.connected),
      { description: `${target} never disconnected` },
    );

    toast.style = Toast.Style.Success;
    toast.title = `Disconnected ${target}`;
  } catch (error) {
    await showFailure("Couldn't disconnect the headset", error);
  }
}

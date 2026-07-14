import { Toast, showToast } from "@raycast/api";
import { disconnectHeadset, getDevices } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Disconnecting headset…" });

  try {
    await disconnectHeadset();
    await pollUntil(
      () => getDevices(),
      (devices) => !devices.some((d) => d.kind === "headset" && d.connected),
    );

    toast.style = Toast.Style.Success;
    toast.title = "Headset disconnected";
  } catch (error) {
    await showFailure("Couldn't disconnect the headset", error);
  }
}

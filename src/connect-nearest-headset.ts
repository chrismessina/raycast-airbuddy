import { Toast, showToast } from "@raycast/api";
import { connectNearest, getAppState, getDevices } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Connecting to nearest headset…" });

  try {
    const state = await getAppState();
    if (!state.nearestHeadsetName) {
      toast.style = Toast.Style.Failure;
      toast.title = "No nearby headset";
      toast.message = "AirBuddy doesn't see a headset right now.";
      return;
    }

    // Re-bind: TS does not carry the null-check above into the closure below.
    const target: string = state.nearestHeadsetName;

    await connectNearest();
    await pollUntil(
      () => getDevices(),
      (devices) => devices.find((d) => d.name === target)?.connected === true,
      { description: `${target} never connected` },
    );

    toast.style = Toast.Style.Success;
    toast.title = `Connected to ${target}`;
  } catch (error) {
    await showFailure("Couldn't connect to the nearest headset", error);
  }
}

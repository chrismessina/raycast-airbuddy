import { Toast, showToast } from "@raycast/api";
import { getDevices, toggleListeningMode } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { type ListeningMode, supportsListeningMode } from "./types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Switching listening mode…" });

  try {
    const before = await getDevices();
    const headset = before.find((d) => supportsListeningMode(d) && d.connected);

    if (!headset) {
      toast.style = Toast.Style.Failure;
      toast.title = "No headset connected";
      toast.message = "Connect a headset that supports listening modes.";
      return;
    }

    const previous = headset.listeningMode;
    const id: string = headset.id;

    await toggleListeningMode();

    const after = await pollUntil(
      () => getDevices(),
      (devices) => {
        const current = devices.find((d) => d.id === id);
        return current !== undefined && current.listeningMode !== previous;
      },
    );

    const now = after.find((d) => d.id === id)?.listeningMode;
    toast.style = Toast.Style.Success;
    toast.title = now ? MODE_LABELS[now] : "Listening mode changed";
  } catch (error) {
    await showFailure("Couldn't switch the listening mode", error);
  }
}

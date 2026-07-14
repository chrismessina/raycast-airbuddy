import { type LaunchProps, Toast, showToast } from "@raycast/api";
import { getDevices, setListeningMode } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { type ListeningMode, supportsListeningMode } from "./types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

export default async function Command(props: LaunchProps<{ arguments: Arguments.SetListeningMode }>) {
  const mode = props.arguments.mode as ListeningMode;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${MODE_LABELS[mode]}…` });

  try {
    const devices = await getDevices();
    const headset = devices.find((d) => supportsListeningMode(d) && d.connected);

    if (!headset) {
      toast.style = Toast.Style.Failure;
      toast.title = "No headset connected";
      toast.message = "Connect a headset that supports listening modes.";
      return;
    }

    // The dropdown is static — it offers all four modes even if this headset supports fewer.
    if (!headset.supportedListeningModes.includes(mode)) {
      toast.style = Toast.Style.Failure;
      toast.title = `${headset.name} doesn't support ${MODE_LABELS[mode]}`;
      toast.message = `Supported: ${headset.supportedListeningModes.map((m) => MODE_LABELS[m]).join(", ")}`;
      return;
    }

    const id: string = headset.id;
    await setListeningMode(mode, id);

    await pollUntil(
      () => getDevices(),
      (list) => list.find((d) => d.id === id)?.listeningMode === mode,
    );

    toast.style = Toast.Style.Success;
    toast.title = MODE_LABELS[mode];
  } catch (error) {
    await showFailure("Couldn't set the listening mode", error);
  }
}

import { type LaunchProps, Toast, showToast } from "@raycast/api";
import { type OutputDevice, getOutputDevice, setListeningMode } from "./airbuddy";
import { failToast, showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { LISTENING_MODE_LABELS, type ListeningMode } from "./types";

export default async function Command(props: LaunchProps<{ arguments: Arguments.SetListeningMode }>) {
  const mode = props.arguments.mode as ListeningMode;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${LISTENING_MODE_LABELS[mode]}…` });

  try {
    // Target the OUTPUT ROUTE, not "the first connected mode-capable device in devices()" — that
    // collection has no documented ordering, so with two headsets connected the old code was a coin
    // flip, while this command's manifest promises "the current headset".
    const output = await getOutputDevice();

    if (!output || output.supportedListeningModes.length === 0) {
      failToast(toast, "No headset connected", "Connect a headset that supports listening modes.");
      return;
    }

    // Re-bind: TS does not carry the guard above into the closures below.
    const target: OutputDevice = output;

    // The dropdown is static (declared in the manifest), so it offers all four modes regardless of
    // what this headset actually supports. Refuse locally: AirBuddy would accept the command and
    // silently no-op it, and we'd poll for a change that can never come.
    if (!target.supportedListeningModes.includes(mode)) {
      failToast(
        toast,
        `${target.name} doesn't support ${LISTENING_MODE_LABELS[mode]}`,
        `Supported: ${target.supportedListeningModes.map((m) => LISTENING_MODE_LABELS[m]).join(", ")}`,
      );
      return;
    }

    // Already in that mode? Say so. Otherwise the poll below waits for a change that will never
    // happen — a 10s spinner ending in a red "never switched" toast, for a no-op.
    if (target.listeningMode === mode) {
      toast.style = Toast.Style.Success;
      toast.title = `Already ${LISTENING_MODE_LABELS[mode]}`;
      return;
    }

    await setListeningMode(mode, target.id);

    await pollUntil(
      () => getOutputDevice(),
      (d) => d?.listeningMode === mode,
      {
        description: `${target.name} never switched to ${LISTENING_MODE_LABELS[mode]}`,
      },
    );

    toast.style = Toast.Style.Success;
    toast.title = LISTENING_MODE_LABELS[mode];
  } catch (error) {
    await showFailure("Couldn't set the listening mode", error);
  }
}

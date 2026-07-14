import { Toast, showToast } from "@raycast/api";
import { getAppState, toggleSpatialAudio } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import type { SpatialAudioMode } from "./types";

const MODE_LABELS: Record<SpatialAudioMode, string> = {
  off: "Spatial Audio Off",
  fixed: "Spatial Audio: Fixed",
  "head tracked": "Spatial Audio: Head Tracked",
};

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Toggling Spatial Audio…" });

  try {
    const before = await getAppState();

    // Fail fast. With no audio output route, AirBuddy ACCEPTS the toggle and silently no-ops it
    // (verified: currentOutputDevice null, mode "off" before and after). Polling for a change
    // that can never come spins for the full timeout and then blames the extension — when the
    // real answer is "there's no headset to apply it to."
    if (!before.currentOutputName) {
      toast.style = Toast.Style.Failure;
      toast.title = "No audio output device";
      toast.message = "Connect a headset before changing Spatial Audio.";
      return;
    }

    const previous = before.spatialAudioMode;

    await toggleSpatialAudio();

    const after = await pollUntil(
      () => getAppState(),
      (state) => state.spatialAudioMode !== previous,
      { description: "Spatial Audio never changed" },
    );

    toast.style = Toast.Style.Success;
    toast.title = MODE_LABELS[after.spatialAudioMode];
  } catch (error) {
    await showFailure("Couldn't toggle Spatial Audio", error);
  }
}

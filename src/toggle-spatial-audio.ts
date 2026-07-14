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
    const previous = before.spatialAudioMode;

    await toggleSpatialAudio();

    const after = await pollUntil(
      () => getAppState(),
      (state) => state.spatialAudioMode !== previous,
    );

    toast.style = Toast.Style.Success;
    toast.title = MODE_LABELS[after.spatialAudioMode];
  } catch (error) {
    await showFailure("Couldn't toggle Spatial Audio", error);
  }
}

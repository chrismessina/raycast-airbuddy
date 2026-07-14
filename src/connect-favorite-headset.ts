import { Toast, showToast } from "@raycast/api";
import { connectFavorite, getDevices, getFavoriteHeadset } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Connecting to favorite headset…" });

  try {
    // Resolve the favorite FIRST — it works even when the headset is in its case and absent
    // from the devices list. If there isn't one, fail now rather than dispatching a doomed connect.
    const favorite = await getFavoriteHeadset();

    if (!favorite) {
      toast.style = Toast.Style.Failure;
      toast.title = "No favorite headset";
      toast.message = "Star a headset in AirBuddy's Devices settings first.";
      return;
    }

    // Re-bind: TS does not carry the null-check above into the closure below.
    const target: { id: string; name: string } = favorite;

    toast.title = `Connecting to ${target.name}…`;

    await connectFavorite();
    await pollUntil(
      () => getDevices(),
      (devices) => devices.find((d) => d.id === target.id)?.connected === true,
    );

    toast.style = Toast.Style.Success;
    toast.title = `Connected to ${target.name}`;
  } catch (error) {
    await showFailure("Couldn't connect to the favorite headset", error);
  }
}

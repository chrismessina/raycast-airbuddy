import { Action, ActionPanel, Icon, Keyboard, Toast, showToast } from "@raycast/api";
import {
  connectDevice,
  disconnectDevice,
  getAppState,
  getDevices,
  setListeningMode,
  showDeviceMenu,
  showStatusWindow,
  toggleSpatialAudio,
} from "../airbuddy";
import { showFailure } from "../feedback";
import { pollUntil } from "../poll";
import { BatteryAlertsForm } from "../battery-alerts";
import { type Device, type ListeningMode, type SpatialAudioMode, supportsListeningMode } from "../types";

const MODE_LABELS: Record<ListeningMode, string> = {
  normal: "Off",
  "noise cancellation": "Noise Cancellation",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

const SPATIAL_LABELS: Record<SpatialAudioMode, string> = {
  off: "Spatial Audio Off",
  fixed: "Spatial Audio: Fixed",
  "head tracked": "Spatial Audio: Head Tracked",
};

export function DeviceActions({ device, onRefresh }: { device: Device; onRefresh: () => void }) {
  async function handleConnect() {
    // Fire the indicator BEFORE the async work. Silence during a long operation is a defect.
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Connecting to ${device.name}…`,
    });

    try {
      await connectDevice(device.id);

      // The command returns on request-ACCEPT, not on Bluetooth settle. Poll the real postcondition.
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.connected === true,
      );

      toast.style = Toast.Style.Success;
      toast.title = `Connected to ${device.name}`;
      onRefresh();
    } catch (error) {
      await showFailure(`Couldn't connect to ${device.name}`, error);
    }
  }

  async function handleDisconnect() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Disconnecting ${device.name}…`,
    });

    try {
      await disconnectDevice(device.id);
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.connected !== true,
      );

      toast.style = Toast.Style.Success;
      toast.title = `Disconnected ${device.name}`;
      onRefresh();
    } catch (error) {
      await showFailure(`Couldn't disconnect ${device.name}`, error);
    }
  }

  async function handleToggleSpatialAudio() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Toggling Spatial Audio…" });

    try {
      // Fire-and-forget, like every AirBuddy action: the command returns on request-accept,
      // not when the mode actually changes. Poll the real postcondition, and name the result.
      const before = (await getAppState()).spatialAudioMode;

      await toggleSpatialAudio();

      const after = await pollUntil(
        () => getAppState(),
        (state) => state.spatialAudioMode !== before,
      );

      toast.style = Toast.Style.Success;
      toast.title = SPATIAL_LABELS[after.spatialAudioMode];
    } catch (error) {
      await showFailure("Couldn't toggle Spatial Audio", error);
    }
  }

  async function handleSetMode(mode: ListeningMode) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${MODE_LABELS[mode]}…` });
    try {
      await setListeningMode(mode, device.id);
      await pollUntil(
        () => getDevices(),
        (devices) => devices.find((d) => d.id === device.id)?.listeningMode === mode,
      );
      toast.style = Toast.Style.Success;
      toast.title = MODE_LABELS[mode];
      onRefresh();
    } catch (error) {
      await showFailure("Couldn't change listening mode", error);
    }
  }

  return (
    <ActionPanel>
      <ActionPanel.Section>
        {device.connected ? (
          <Action title="Disconnect" icon={Icon.Plug} onAction={handleDisconnect} />
        ) : (
          <Action title="Connect" icon={Icon.Plug} onAction={handleConnect} />
        )}

        {/* Rendered ONLY for devices that actually support listening modes. */}
        {supportsListeningMode(device) && (
          <ActionPanel.Submenu
            title="Listening Mode"
            icon={Icon.Headphones}
            shortcut={{ modifiers: ["cmd"], key: "l" }}
          >
            {device.supportedListeningModes.map((mode) => (
              <Action key={mode} title={MODE_LABELS[mode]} onAction={() => handleSetMode(mode)} />
            ))}
          </ActionPanel.Submenu>
        )}
      </ActionPanel.Section>

      <ActionPanel.Section>
        <Action
          title="Show Status Window"
          icon={Icon.Window}
          shortcut={Keyboard.Shortcut.Common.Open}
          onAction={async () => {
            try {
              await showStatusWindow(device.id);
            } catch (error) {
              await showFailure("Couldn't show the status window", error);
            }
          }}
        />
        <Action
          title="Show Device Menu"
          icon={Icon.List}
          shortcut={Keyboard.Shortcut.Common.OpenWith}
          onAction={async () => {
            try {
              await showDeviceMenu(device.id);
            } catch (error) {
              await showFailure("Couldn't show the device menu", error);
            }
          }}
        />
        <Action.Push
          title="Configure Battery Alerts"
          icon={Icon.Bell}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={<BatteryAlertsForm device={device} />}
        />
        <Action
          title="Toggle Spatial Audio"
          icon={Icon.Speaker}
          // NOT cmd+shift+S — Raycast already binds that to Common.Duplicate, so it would
          // hijack the user's muscle memory. cmd+shift+A is free in this panel.
          shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
          onAction={handleToggleSpatialAudio}
        />
      </ActionPanel.Section>

      <ActionPanel.Section>
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onRefresh}
        />
        <Action.CopyToClipboard title="Copy Device ID" content={device.id} shortcut={Keyboard.Shortcut.Common.Copy} />
        <Action.CopyToClipboard
          title="Copy Device Name"
          content={device.name}
          shortcut={Keyboard.Shortcut.Common.CopyName}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

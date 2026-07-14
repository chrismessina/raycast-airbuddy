import { List } from "@raycast/api";
import { useState } from "react";
import { DeviceActions } from "./components/device-actions";
import { DeviceListItem } from "./components/device-list-item";
import { ErrorView } from "./components/error-views";
import { useDevices } from "./hooks/use-devices";
import { OTHER_SECTION, type Device, sectionFor } from "./types";

type Filter = "all" | "connected" | "headsets";

// Fixed order — the list must not reshuffle as devices appear and disappear.
// Fixed order — the list must not reshuffle as devices appear and disappear. OTHER_SECTION is last
// and normally empty; it exists so a device kind AirBuddy adds later still renders instead of being
// silently filtered out of the list (this array is what decides which sections are drawn at all).
const SECTION_ORDER = [
  "AirPods",
  "Macs",
  "iPhones, iPads, and Apple Watch",
  "Keyboards, Mice, and Other Peripherals",
  OTHER_SECTION,
];

function applyFilter(devices: Device[], filter: Filter): Device[] {
  switch (filter) {
    case "connected":
      return devices.filter((d) => d.connected);
    case "headsets":
      return devices.filter((d) => d.kind === "headset");
    case "all":
      return devices;
  }
}

export default function Command() {
  const { devices, isLoading, error, revalidate } = useDevices();
  const [filter, setFilter] = useState<Filter>("all");

  if (error) {
    return (
      <List>
        <ErrorView error={error} onRetry={revalidate} />
      </List>
    );
  }

  const filtered = applyFilter(devices, filter);

  const grouped = new Map<string, Device[]>();
  for (const device of filtered) {
    const section = sectionFor(device);
    const existing = grouped.get(section);
    if (existing) existing.push(device);
    else grouped.set(section, [device]);
  }

  return (
    <List
      isLoading={isLoading}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={filter} onChange={(v) => setFilter(v as Filter)}>
          <List.Dropdown.Item title="All Devices" value="all" />
          <List.Dropdown.Item title="Connected" value="connected" />
          <List.Dropdown.Item title="Headsets" value="headsets" />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        title={isLoading ? "Loading Devices…" : "No Devices"}
        description={
          isLoading
            ? undefined
            : "AirBuddy only reports devices that are currently live. Turn a device on, or take your AirPods out of their case."
        }
      />

      {SECTION_ORDER.filter((title) => grouped.has(title)).map((title) => (
        <List.Section key={title} title={title} subtitle={String(grouped.get(title)?.length ?? 0)}>
          {grouped.get(title)?.map((device) => (
            <DeviceListItem
              key={device.id}
              device={device}
              actions={<DeviceActions device={device} onRefresh={revalidate} />}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

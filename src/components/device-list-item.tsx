import { Color, Icon, List } from "@raycast/api";
import type { ReactNode } from "react";
import {
  type Device,
  batteryColor,
  budsDiverge,
  caseBattery,
  iconFor,
  primaryBattery,
  supportsListeningMode,
} from "../types";

const MODE_LABELS: Record<string, string> = {
  normal: "Off",
  "noise cancellation": "ANC",
  transparency: "Transparency",
  adaptive: "Adaptive",
};

function subtitleFor(device: Device): string | undefined {
  // Only headsets carry meaningful in-ear/route/proximity state.
  if (device.kind !== "headset") return undefined;

  const parts: string[] = [];
  if (device.anyBudInEar) parts.push("In ear");
  else if (device.anyBudInCase) parts.push("In case");

  if (device.outputRoute && device.inputRoute) parts.push("Output + Input");
  else if (device.outputRoute) parts.push("Output");
  else if (device.inputRoute) parts.push("Input");

  if (device.distance !== "unknown") {
    parts.push(device.distance.charAt(0).toUpperCase() + device.distance.slice(1));
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function DeviceListItem({ device, actions }: { device: Device; actions: ReactNode }) {
  const accessories: List.Item.Accessory[] = [];

  // Listening mode — ONLY when the device actually supports one. A trackpad reports
  // listeningMode: "transparency" with supportedListeningModes: []. Never trust the former alone.
  if (supportsListeningMode(device)) {
    accessories.push({
      tag: { value: MODE_LABELS[device.listeningMode] ?? device.listeningMode, color: Color.Purple },
    });
  }

  const chargeCase = caseBattery(device);
  if (chargeCase) {
    accessories.push({
      icon: { source: Icon.Battery, tintColor: batteryColor(chargeCase) },
      text: `${Math.round(chargeCase.level)}%`,
      tooltip: `Charging case: ${Math.round(chargeCase.level)}%`,
    });
  }

  if (budsDiverge(device)) {
    const left = device.batteries.find((b) => b.position === "left bud");
    const right = device.batteries.find((b) => b.position === "right bud");
    if (left && right) {
      accessories.push({
        text: `L ${Math.round(left.level)}% · R ${Math.round(right.level)}%`,
        tooltip: "Earbuds differ",
      });
    }
  }

  const primary = primaryBattery(device);
  if (primary) {
    const charging = primary.chargingState !== "discharging";
    accessories.push({
      icon: {
        source: charging ? Icon.BatteryCharging : Icon.Battery,
        tintColor: batteryColor(primary),
      },
      text: `${Math.round(primary.level)}%`,
      tooltip: primary.unreliable
        ? `${Math.round(primary.level)}% (AirBuddy reports this reading as unreliable)`
        : `${Math.round(primary.level)}% · ${primary.chargingState}`,
    });
  }

  return (
    <List.Item
      icon={iconFor(device)}
      title={device.name}
      subtitle={subtitleFor(device)}
      accessories={accessories}
      actions={actions}
    />
  );
}

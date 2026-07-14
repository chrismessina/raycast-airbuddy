import { Action, ActionPanel, Form, Icon, Keyboard, Toast, showToast, useNavigation } from "@raycast/api";
import { Fragment, useState } from "react";
import { setBatteryAlert } from "./airbuddy";
import { showFailure } from "./feedback";
import type { BatteryAlert, Device } from "./types";

const POSITION_LABELS: Record<string, string> = {
  main: "Battery",
  "combined buds": "Earbuds",
  // AirBuddy stores multipart bud alerts through the left-bud entry when there is no `main` part.
  // Label it honestly for the user; the underlying position is passed through untouched.
  "left bud": "Earbuds",
  "right bud": "Right Earbud",
  "charging case": "Charging Case",
};

const KIND_LABELS: Record<string, string> = {
  "low battery": "Low Battery",
  charged: "Charged",
};

function rowKey(alert: BatteryAlert): string {
  return `${alert.kind}|${alert.position}`;
}

export function BatteryAlertsForm({ device }: { device: Device }) {
  const { pop } = useNavigation();
  const [isSaving, setIsSaving] = useState(false);

  const [values, setValues] = useState(() => {
    const initial: Record<string, { enabled: boolean; threshold: string }> = {};
    for (const alert of device.alerts) {
      initial[rowKey(alert)] = {
        enabled: alert.enabled,
        threshold: String(Math.round(alert.threshold)),
      };
    }
    return initial;
  });

  async function handleSave() {
    // Validate before dispatching — AirBuddy may silently reject a bad value.
    for (const alert of device.alerts) {
      const raw = values[rowKey(alert)];
      const threshold = Number(raw.threshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Invalid threshold",
          message: `${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]} must be 0–100.`,
        });
        return;
      }
    }

    setIsSaving(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Saving alerts…" });

    // NOT ATOMIC. These are N independent fire-and-forget calls; AirBuddy offers no transaction.
    // If one fails, earlier ones have already applied — say so rather than pretending otherwise.
    const applied: string[] = [];
    try {
      for (const alert of device.alerts) {
        const raw = values[rowKey(alert)];
        const threshold = Number(raw.threshold);

        const unchanged = alert.enabled === raw.enabled && Math.round(alert.threshold) === threshold;
        if (unchanged) continue;

        await setBatteryAlert(device.id, alert.kind, alert.position, threshold, raw.enabled);
        applied.push(`${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]}`);
      }

      toast.style = Toast.Style.Success;
      toast.title = applied.length > 0 ? "Alerts saved" : "No changes";
      pop();
    } catch (error) {
      const detail =
        applied.length > 0 ? `Applied: ${applied.join(", ")}. The rest did not save.` : "No changes were applied.";
      await showFailure(`Couldn't save all alerts. ${detail}`, error);
    } finally {
      setIsSaving(false);
    }
  }

  if (device.alerts.length === 0) {
    return (
      <Form>
        <Form.Description title="No Alerts" text={`AirBuddy doesn't report any battery alerts for ${device.name}.`} />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={`Battery Alerts — ${device.name}`}
      actions={
        <ActionPanel>
          <Action
            title="Save Alerts"
            icon={Icon.Check}
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={handleSave}
          />
        </ActionPanel>
      }
    >
      {device.alerts.map((alert) => {
        const key = rowKey(alert);
        const label = `${KIND_LABELS[alert.kind]} · ${POSITION_LABELS[alert.position]}`;
        return (
          <Fragment key={key}>
            <Form.Checkbox
              id={`${key}-enabled`}
              label={label}
              value={values[key].enabled}
              onChange={(enabled) => setValues((v) => ({ ...v, [key]: { ...v[key], enabled } }))}
            />
            <Form.TextField
              id={`${key}-threshold`}
              title="Threshold (%)"
              placeholder="0–100"
              value={values[key].threshold}
              onChange={(threshold) => setValues((v) => ({ ...v, [key]: { ...v[key], threshold } }))}
            />
          </Fragment>
        );
      })}
    </Form>
  );
}

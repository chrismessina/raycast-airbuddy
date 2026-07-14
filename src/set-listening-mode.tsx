import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { type OutputDevice, getOutputDevice, setListeningMode } from "./airbuddy";
import { showFailure } from "./feedback";
import { pollUntil } from "./poll";
import { LISTENING_MODE_LABELS, type ListeningMode, listeningModeIcon } from "./types";

/**
 * A VIEW command, not the manifest-declared dropdown argument it started as.
 *
 * Two things a static manifest dropdown genuinely cannot do — verified against Raycast's own
 * extension.json schema, `arguments[].data[]` only accepts `{ title, value }`, no `icon` — and
 * neither can it know, at build time, which mode is currently active:
 *   1. Show an icon per mode.
 *   2. Pre-select / mark the mode the headset is already on.
 *   3. List only the modes THIS headset actually supports — the old static dropdown always offered
 *      all four regardless of hardware, which needed a "doesn't support that mode" guard after the
 *      fact. A Form built from live data doesn't need the guard; the option is never there.
 *
 * `Form.Dropdown.Item` supports `icon` (verified in the installed @raycast/api types), which is what
 * unlocks all three.
 */
export default function Command() {
  const { pop } = useNavigation();
  const [output, setOutput] = useState<OutputDevice | null | undefined>(undefined);

  useEffect(() => {
    getOutputDevice().then(setOutput, () => setOutput(null));
  }, []);

  async function handleSubmit(values: { mode: string }) {
    const mode = values.mode as ListeningMode;

    if (!output) return; // Form has no target; nothing to submit. Guarded by isLoading below too.

    // Already on it? Say so rather than dispatching a no-op and claiming we "set" it.
    if (output.listeningMode === mode) {
      await showToast({ style: Toast.Style.Success, title: `Already ${LISTENING_MODE_LABELS[mode]}` });
      pop();
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${LISTENING_MODE_LABELS[mode]}…` });

    try {
      await setListeningMode(mode, output.id);

      await pollUntil(
        () => getOutputDevice(),
        (d) => d?.listeningMode === mode,
        {
          description: `${output.name} never switched to ${LISTENING_MODE_LABELS[mode]}`,
        },
      );

      toast.style = Toast.Style.Success;
      toast.title = LISTENING_MODE_LABELS[mode];
      pop();
    } catch (error) {
      await showFailure("Couldn't set the listening mode", error);
    }
  }

  const isLoading = output === undefined;
  const hasHeadset = output != null && output.supportedListeningModes.length > 0;

  return (
    <Form
      isLoading={isLoading}
      actions={
        hasHeadset ? (
          <ActionPanel>
            <Action.SubmitForm title="Set Listening Mode" icon={Icon.Checkmark} onSubmit={handleSubmit} />
          </ActionPanel>
        ) : undefined
      }
    >
      {!isLoading && !hasHeadset && (
        <Form.Description
          title="No Headset Connected"
          text="Connect a headset that supports listening modes, then run this command again."
        />
      )}
      {hasHeadset && (
        <Form.Dropdown id="mode" title="Listening Mode" defaultValue={output.listeningMode}>
          {output.supportedListeningModes.map((mode) => (
            <Form.Dropdown.Item
              key={mode}
              value={mode}
              title={LISTENING_MODE_LABELS[mode]}
              icon={listeningModeIcon(mode)}
            />
          ))}
        </Form.Dropdown>
      )}
    </Form>
  );
}

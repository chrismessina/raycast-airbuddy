import { Clipboard, Toast, showToast } from "@raycast/api";

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The ONLY sanctioned way to show a failure. House style requires a "Copy Error" primaryAction on
 * every failure toast; putting it here means no call site can omit it.
 */
export async function showFailure(title: string, error: unknown): Promise<void> {
  const message = describeError(error);
  await showToast({
    style: Toast.Style.Failure,
    title,
    message,
    primaryAction: {
      title: "Copy Error",
      onAction: async () => {
        await Clipboard.copy(message);
      },
    },
  });
}

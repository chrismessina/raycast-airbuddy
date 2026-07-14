import { Clipboard, Toast, showToast } from "@raycast/api";

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  // `String({})` yields "[object Object]" — copying that defeats the whole point of Copy Error.
  // Serialize objects so the user pastes something a human (or a bug report) can actually use.
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unserializable error object";
    }
  }

  return String(error);
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

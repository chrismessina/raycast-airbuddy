export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export class PollTimeoutError extends Error {
  constructor(message = "Timed out waiting for AirBuddy to settle.") {
    super(message);
    this.name = "PollTimeoutError";
  }
}

/**
 * AirBuddy's action commands return when the request is ACCEPTED, not when Bluetooth settles.
 * Never report success on the return of an action — poll the postcondition instead.
 */
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await read();
    if (done(value)) return value;

    if (Date.now() >= deadline) {
      throw new PollTimeoutError();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

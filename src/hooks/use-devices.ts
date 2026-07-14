import { useCachedPromise } from "@raycast/utils";
import { useEffect, useRef } from "react";
import { getDevices } from "../airbuddy";
import type { Device } from "../types";

const REFRESH_MS = 5_000;

/** Return type annotated to pin the non-paginated overload. Without it, `data` infers as any[]. */
const fetchDevices = (signal?: AbortSignal): Promise<Device[]> => getDevices(signal);

export function useDevices() {
  const abortable = useRef<AbortController>(null);

  // Tracks whether a fetch is actually outstanding.
  //
  // This CANNOT be done by wrapping `revalidate()` in try/finally: useCachedPromise's
  // `revalidate` is `() => void` (@raycast/utils types.d.ts:119 — note that the
  // `() => Promise<T>` on line 82 belongs to usePromise, a different hook). Setting and
  // clearing the flag around a synchronous void call clears it in the same tick, so the
  // guard never skips anything. The lifecycle callbacks are the only honest signal.
  const inFlight = useRef(false);

  const { data, isLoading, error, revalidate } = useCachedPromise(fetchDevices, [], {
    initialData: [] as Device[],
    keepPreviousData: true,
    abortable,
    onWillExecute: () => {
      inFlight.current = true;
    },
    onData: () => {
      inFlight.current = false;
    },
    onError: () => {
      inFlight.current = false;
    },
  });

  useEffect(() => {
    const id = setInterval(() => {
      // A slow osascript must not stack up a queue of subprocesses: skip this tick if the
      // previous fetch hasn't returned.
      if (inFlight.current) return;
      revalidate();
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [revalidate]);

  return { devices: data ?? [], isLoading, error, revalidate };
}

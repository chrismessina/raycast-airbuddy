import { useCachedPromise } from "@raycast/utils";
import { useEffect, useRef } from "react";
import { getDevices } from "../airbuddy";
import type { Device } from "../types";

const REFRESH_MS = 5_000;

/** Return type annotated to pin the non-paginated overload. Without it, `data` infers as any[]. */
const fetchDevices = (): Promise<Device[]> => getDevices();

export function useDevices() {
  const { data, isLoading, error, revalidate } = useCachedPromise(fetchDevices, [], {
    initialData: [] as Device[],
    keepPreviousData: true,
  });

  const inFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      // Non-overlap guard: a slow osascript must not stack up a queue of subprocesses.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        revalidate();
      } finally {
        inFlight.current = false;
      }
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [revalidate]);

  return { devices: data ?? [], isLoading, error, revalidate };
}

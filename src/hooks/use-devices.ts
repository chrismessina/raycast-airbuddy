import { useCachedPromise } from "@raycast/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDevices } from "../airbuddy";
import type { Device } from "../types";

const REFRESH_MS = 5_000;

export function useDevices() {
  const abortable = useRef<AbortController>(null);

  // The fetcher must read the signal off the ref ITSELF.
  //
  // useCachedPromise does NOT inject it: it calls the fetcher as `fn(...args)` with our `args`
  // (which is []), so a `(signal?: AbortSignal)` parameter is ALWAYS undefined. The hook only owns
  // the controller — aborting the previous one and minting a new one. Raycast's own useFetch/useExec
  // work because their internal fetchers close over `abortable.current?.signal` exactly like this.
  //
  // Without this, the AbortSignal never reaches execFile and the osascript child is never killed on
  // unmount — it runs to the full 10s timeout while the user has already navigated away.
  //
  // The explicit `Promise<Device[]>` return type is load-bearing for a SECOND reason: it pins
  // useCachedPromise's non-paginated overload. Drop it and `data` silently infers as `any[]`, with
  // no error and no lint warning.
  const fetchDevices = useCallback((): Promise<Device[]> => getDevices(abortable.current?.signal), []);

  // `isLoading` from useCachedPromise goes true on EVERY fetch — including the 5s background poll.
  // Feeding it straight to <List isLoading> pulses the loading bar every 5 seconds forever, which
  // reads as a broken, perpetually-loading list. What the UI actually wants is "have we ever
  // finished a fetch?" — the first load shows a spinner; every refresh after that is silent.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

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
      setHasLoadedOnce(true);
    },
    onError: () => {
      inFlight.current = false;
      setHasLoadedOnce(true);
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

  return {
    devices: data ?? [],
    /** True ONLY until the first fetch resolves. Background polls refresh silently. */
    isLoading: isLoading && !hasLoadedOnce,
    error,
    revalidate,
  };
}

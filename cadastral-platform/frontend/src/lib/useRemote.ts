"use client";
import { useCallback, useEffect, useState } from "react";
import type { Sampled } from "./types";
/** Load a Sampled<T> from the api. `sample` tells the page to show the Sample data banner. */
export function useRemote<T>(load: () => Promise<Sampled<T>>, deps: unknown[]) {
  const [state, set] = useState<{ data?: T; sample: boolean; error?: string; loading: boolean }>({ sample: false, loading: true });
  const run = useCallback(() => { set((s) => ({ ...s, loading: true, error: undefined })); load().then((r) => set({ data: r.data, sample: r.sample, loading: false }), (e) => set({ sample: false, error: (e as Error).message, loading: false })); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(run, [run]);
  return { ...state, reload: run };
}

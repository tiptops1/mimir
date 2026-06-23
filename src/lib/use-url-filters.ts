"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Drives list filtering through the URL search params, live (no submit button).
 * The server page reads the same params, so navigating re-renders the list.
 *
 * - `setNow`      — push a param immediately (use for <select> changes).
 * - `setDebounced`— push after a pause (use for free-text typing).
 * - `reset`       — clear all filters.
 * Any filter change drops `page` so the user lands back on page 1.
 */
export function useUrlFilters() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // One debounce timer per field, so typing in one input can't cancel another's.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const get = useCallback((key: string) => params.get(key) ?? "", [params]);

  const apply = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const setNow = useCallback(
    (key: string, value: string) => {
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      apply(key, value);
    },
    [apply],
  );

  const setDebounced = useCallback(
    (key: string, value: string) => {
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      timers.current.set(
        key,
        setTimeout(() => apply(key, value), 300),
      );
    },
    [apply],
  );

  const reset = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { get, setNow, setDebounced, reset };
}

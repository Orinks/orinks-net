"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The current path with its query string, for redirect_url. usePathname()
 * drops the query, and useSearchParams() would need a Suspense boundary
 * around the header on every static page, so the query is read from the
 * location after hydration (empty on the server).
 */
export function useReturnPath(): string {
  const pathname = usePathname() ?? "";
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return pathname + search;
}

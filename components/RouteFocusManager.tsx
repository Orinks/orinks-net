"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function RouteFocusManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = pathname + "?" + searchParams.toString();
  const previousRoute = useRef(routeKey);

  useEffect(() => {
    if (previousRoute.current === routeKey) {
      return;
    }
    previousRoute.current = routeKey;
    if (window.location.hash) {
      return;
    }


    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLHeadingElement>("main h1")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeKey]);

  return null;
}

"use client";

import { useEffect } from "react";
import { PENDING_FOCUS_KEY } from "./FreightFateEventLink";

export function FreightFateHashFocus() {
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_FOCUS_KEY);
    if (!pending || pending !== window.location.hash) return;
    sessionStorage.removeItem(PENDING_FOCUS_KEY);
    requestAnimationFrame(() => {
      document.getElementById(pending.slice(1))?.focus({ preventScroll: true });
    });
  }, []);
  return null;
}

"use client";

// Two permanently-mounted live regions (per accessibility review):
// - status (polite): score changes, feedback bundles, tape drops
// - alert (assertive): game over and errors only
//
// announce() bundles messages fired in the same tick into ONE region write
// (simultaneous writes get dropped by JAWS), and clears-then-sets so an
// identical message announces again.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Channel = "status" | "alert";

const AnnouncerContext = createContext<(message: string, channel?: Channel) => void>(() => {});

export function useAnnounce() {
  return useContext(AnnouncerContext);
}

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [statusText, setStatusText] = useState("");
  const [alertText, setAlertText] = useState("");
  const queues = useRef<{ status: string[]; alert: string[] }>({ status: [], alert: [] });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string, channel: Channel = "status") => {
    const trimmed = message.trim();
    if (!trimmed) return;
    queues.current[channel].push(trimmed);
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const statusBundle = queues.current.status.join(" ");
      const alertBundle = queues.current.alert.join(" ");
      queues.current = { status: [], alert: [] };
      // Clear first so repeating the same text still announces.
      setStatusText("");
      setAlertText("");
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        clearTimer.current = null;
        if (statusBundle) setStatusText(statusBundle);
        if (alertBundle) setAlertText(alertBundle);
      }, 50);
    }, 30);
  }, []);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div aria-atomic="true" className="sr-only" role="status">
        {statusText}
      </div>
      <div aria-atomic="true" className="sr-only" role="alert">
        {alertText}
      </div>
    </AnnouncerContext.Provider>
  );
}

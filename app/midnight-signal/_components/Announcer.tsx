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
import {
  SerializedAnnouncementQueue,
  type AnnouncementChannel,
} from "../_lib/announcementQueue";

type Channel = AnnouncementChannel;

const AnnouncerContext = createContext<(message: string, channel?: Channel) => void>(() => {});

export function useAnnounce() {
  return useContext(AnnouncerContext);
}

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [statusText, setStatusText] = useState("");
  const [alertText, setAlertText] = useState("");
  const queue = useRef<SerializedAnnouncementQueue | null>(null);

  if (!queue.current) {
    queue.current = new SerializedAnnouncementQueue({
      emit: (channel, text) => {
        if (channel === "status") setStatusText(text);
        else setAlertText(text);
      },
    });
  }

  const announce = useCallback((message: string, channel: Channel = "status") => {
    const trimmed = message.trim();
    if (!trimmed) return;
    queue.current?.enqueue(trimmed, channel);
  }, []);

  useEffect(
    () => () => {
      queue.current?.dispose();
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

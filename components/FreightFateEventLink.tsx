"use client";

import type { MouseEvent, ReactNode } from "react";

const PENDING_FOCUS_KEY = "freight-fate-pending-event-focus";

export function FreightFateEventLink({ href, fragment, children }: {
  href: string; fragment: string; children: ReactNode;
}) {
  function rememberForwardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      sessionStorage.setItem(PENDING_FOCUS_KEY, `#${fragment}`);
    }
  }
  return <a href={`${href}#${fragment}`} onClick={rememberForwardNavigation}>{children}</a>;
}

export { PENDING_FOCUS_KEY };

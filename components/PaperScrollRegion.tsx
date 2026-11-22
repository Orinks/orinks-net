"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A table that may be wider than the screen. While it overflows, its wrapper
 * is a labelled region and a Tab stop, the only way a keyboard reaches the
 * clipped columns. While it fits, the wrapper is a plain box: a stop that
 * scrolls nothing is one more Tab and a second reading of the caption
 * (accessibility delta review, 2026-11-22). The server renders the region,
 * so a page without JavaScript keeps the keyboard route.
 */
export function PaperScrollRegion({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(true);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      aria-labelledby={overflows ? labelledBy : undefined}
      className="overflow-x-auto p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      ref={box}
      role={overflows ? "region" : undefined}
      tabIndex={overflows ? 0 : undefined}
    >
      {children}
    </div>
  );
}

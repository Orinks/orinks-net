"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function RouteFocusManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = pathname + "?" + searchParams.toString();
  const previousRoute = useRef(routeKey);
  const previousHeading = useRef<{ element: HTMLHeadingElement; text: string } | undefined>(
    undefined,
  );

  useEffect(() => {
    if (previousRoute.current === routeKey) {
      const heading = document.querySelector<HTMLHeadingElement>("main h1");
      if (heading) {
        previousHeading.current = { element: heading, text: heading.textContent ?? "" };
      }
      return;
    }
    previousRoute.current = routeKey;
    if (window.location.hash) {
      return;
    }

    let frame: number | undefined;
    let timeout: number | undefined;
    let observer: MutationObserver | undefined;
    let finished = false;
    const passiveCapture = { capture: true, passive: true } as const;

    const stopWaiting = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      observer?.disconnect();
      document.removeEventListener("click", stopWaiting, true);
      document.removeEventListener("focusin", stopWaiting, true);
      document.removeEventListener("keydown", stopWaiting, true);
      document.removeEventListener("pointerdown", stopWaiting, true);
      document.removeEventListener("wheel", stopWaiting, passiveCapture);
    };

    const focusHeading = () => {
      if (finished) {
        return false;
      }
      const heading = document.querySelector<HTMLHeadingElement>("main h1");
      if (!heading) {
        return false;
      }
      const priorHeading = previousHeading.current;
      if (
        priorHeading?.element === heading &&
        priorHeading.text === (heading.textContent ?? "")
      ) {
        return false;
      }
      stopWaiting();
      if (!heading.hasAttribute("tabindex")) {
        heading.tabIndex = -1;
      }
      previousHeading.current = { element: heading, text: heading.textContent ?? "" };
      heading.focus();
      return true;
    };

    document.addEventListener("click", stopWaiting, true);
    document.addEventListener("focusin", stopWaiting, true);
    document.addEventListener("keydown", stopWaiting, true);
    document.addEventListener("pointerdown", stopWaiting, true);
    document.addEventListener("wheel", stopWaiting, passiveCapture);

    observer = new MutationObserver(() => {
      focusHeading();
    });
    observer.observe(document.body, { characterData: true, childList: true, subtree: true });
    frame = window.requestAnimationFrame(focusHeading);
    if (finished) {
      window.cancelAnimationFrame(frame);
    } else {
      timeout = window.setTimeout(stopWaiting, 1500);
    }

    return stopWaiting;
  }, [routeKey]);

  return null;
}

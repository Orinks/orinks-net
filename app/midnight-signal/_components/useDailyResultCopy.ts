"use client";

import { useCallback, useRef, useState } from "react";

type Announce = (message: string, channel?: "status" | "alert") => void;

export function useDailyResultCopy(announce: Announce) {
  const [copyFallback, setCopyFallback] = useState(false);
  const copyFallbackRef = useRef<HTMLTextAreaElement>(null);
  const resetCopyFallback = useCallback(() => setCopyFallback(false), []);
  const copyDailyResult = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyFallback(false);
        announce("Result copied to clipboard.");
      } catch {
        setCopyFallback(true);
        requestAnimationFrame(() => {
          copyFallbackRef.current?.focus();
          copyFallbackRef.current?.select();
        });
        announce(
          "Couldn't copy automatically. The result text is selected below — press Control C (Command C on Mac) to copy.",
          "alert",
        );
      }
    },
    [announce],
  );
  return { copyDailyResult, copyFallback, copyFallbackRef, resetCopyFallback };
}
